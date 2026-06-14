/**
 * clipia — official TypeScript client for the Clipia public API.
 *
 * Zero runtime dependencies; built on the global `fetch`. Mirrors the fal.ai
 * queue DX (`submit → status → result` + `subscribe`) but with Clipia-native
 * names and credit-based billing.
 *
 * @example
 * ```ts
 * import { createClient } from 'clipia-ai';
 *
 * const clipia = createClient({ apiKey: process.env.CLIPIA_KEY! });
 * const out = await clipia.subscribe('nano-banana-2', {
 *   input: { prompt: 'a sunset over mountains, cinematic' },
 *   onQueueUpdate: (s) => console.log(s.status),
 * });
 * console.log(out.output?.images?.[0]?.url);
 * ```
 */

import type {
  Account,
  ApiErrorEnvelope,
  EstimateResponse,
  GenerationInput,
  ModelDetail,
  ModelList,
  ResultResponse,
  StatusResponse,
  SubmitOptions,
  SubmitResponse,
  SubscribeOptions,
} from './types.js';
import { TERMINAL_STATUSES } from './types.js';

export * from './types.js';
export { verifyWebhookSignature } from './webhook.js';
export type {
  VerifyWebhookOptions,
  WebhookPayload,
} from './webhook.js';

const DEFAULT_BASE_URL = 'https://api.clipia.ai';
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 600_000;

/** SDK version — keep in sync with package.json. */
export const VERSION = '1.0.0';
const USER_AGENT = `clipia-sdk-js/${VERSION}`;

/** Configuration for {@link createClient}. */
export interface ClientConfig {
  /** API key (`clipia_live_…` / `clipia_test_…`). Sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** Override the API base URL. Default `https://api.clipia.ai`. */
  baseUrl?: string;
  /** Inject a custom fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
}

/**
 * Typed error thrown for every non-2xx API response. Carries the HTTP
 * `status`, the machine-readable `code`, the error `type`, and a `message`.
 */
export class ClipiaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;

  constructor(params: {
    status: number;
    code: string;
    type: string;
    message: string;
  }) {
    super(params.message);
    this.name = 'ClipiaApiError';
    this.status = params.status;
    this.code = params.code;
    this.type = params.type;
    // Restore prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, ClipiaApiError.prototype);
  }
}

/** Generate a RFC-4122 v4 UUID without runtime dependencies. */
function generateUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  // Idempotency keys must be unguessable; a weak PRNG (Math.random) is not an
  // acceptable fallback, so fail loudly instead of degrading silently.
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'Secure crypto (randomUUID/getRandomValues) is not available in this environment',
    );
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** The fully constructed client returned by {@link createClient}. */
export interface ClipiaClient {
  queue: {
    submit(model: string, options: SubmitOptions): Promise<SubmitResponse>;
    status(requestId: string, signal?: AbortSignal): Promise<StatusResponse>;
    result(requestId: string, signal?: AbortSignal): Promise<ResultResponse>;
  };
  subscribe(model: string, options: SubscribeOptions): Promise<ResultResponse>;
  models: {
    list(signal?: AbortSignal): Promise<ModelList>;
    get(slug: string, signal?: AbortSignal): Promise<ModelDetail>;
    /** Estimate the deterministic credit cost of an `input` for a model. */
    estimate(
      slug: string,
      input: GenerationInput,
      signal?: AbortSignal,
    ): Promise<EstimateResponse>;
  };
  account: {
    get(signal?: AbortSignal): Promise<Account>;
  };
}

/**
 * Create a Clipia API client.
 *
 * @param config - {@link ClientConfig} with at least `apiKey`.
 */
export function createClient(config: ClientConfig): ClipiaClient {
  if (!config || typeof config.apiKey !== 'string' || !config.apiKey) {
    throw new TypeError('createClient: `apiKey` is required.');
  }

  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError(
      'createClient: global `fetch` is unavailable; pass a `fetch` implementation.',
    );
  }

  async function request<T>(
    path: string,
    init: {
      method: 'GET' | 'POST';
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      /** HTTP statuses that should NOT throw (e.g. 202 for pending results). */
      acceptStatuses?: number[];
    },
  ): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...init.headers,
    };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method,
        headers,
        body,
        signal: init.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      // Do not embed the request path/baseUrl in the message — it can leak
      // internal URL structure when a custom baseUrl is configured.
      throw new ClipiaApiError({
        status: 0,
        code: 'network_error',
        type: 'connection_error',
        message: `Network request failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    const accept = init.acceptStatuses ?? [];
    const text = await response.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (response.ok || accept.includes(response.status)) {
      return { status: response.status, data: parsed as T };
    }

    const envelope = parsed as ApiErrorEnvelope | undefined;
    const e = envelope?.error;
    throw new ClipiaApiError({
      status: response.status,
      code: e?.code ?? 'unknown_error',
      type: e?.type ?? 'api_error',
      message: e?.message ?? `Request failed with HTTP ${response.status}`,
    });
  }

  const queue: ClipiaClient['queue'] = {
    async submit(model, options) {
      if (!options || typeof options.input !== 'object' || options.input === null) {
        throw new TypeError('queue.submit: `input` object is required.');
      }
      const idempotencyKey = options.idempotencyKey ?? generateUuid();
      const body: Record<string, unknown> = { input: options.input };
      if (options.webhookUrl) body.webhook_url = options.webhookUrl;

      const { data } = await request<SubmitResponse>(
        `/v1/models/${encodeURIComponent(model)}`,
        {
          method: 'POST',
          body,
          headers: { 'Idempotency-Key': idempotencyKey },
          signal: options.signal,
        },
      );
      return data;
    },

    async status(requestId, signal) {
      const { data } = await request<StatusResponse>(
        `/v1/requests/${encodeURIComponent(requestId)}/status`,
        { method: 'GET', signal },
      );
      return data;
    },

    async result(requestId, signal) {
      const { status, data } = await request<ResultResponse>(
        `/v1/requests/${encodeURIComponent(requestId)}`,
        { method: 'GET', signal, acceptStatuses: [202] },
      );
      // 202 → still running. Return the shape with a `pending` flag instead of
      // throwing, so callers can branch without try/catch.
      if (status === 202) {
        return { ...data, pending: true };
      }
      return { ...data, pending: false };
    },
  };

  async function subscribe(
    model: string,
    options: SubscribeOptions,
  ): Promise<ResultResponse> {
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const signal = options.signal;

    const submitted = await queue.submit(model, {
      input: options.input,
      webhookUrl: options.webhookUrl,
      idempotencyKey: options.idempotencyKey,
      signal,
    });

    const requestId = submitted.request_id;
    const deadline = Date.now() + timeoutMs;

    // Surface the initial enqueue state through the callback too.
    options.onQueueUpdate?.({
      request_id: requestId,
      status: submitted.status,
      queue_position: submitted.queue_position ?? null,
    });

    for (;;) {
      if (Date.now() >= deadline) {
        throw new ClipiaApiError({
          status: 0,
          code: 'subscribe_timeout',
          type: 'timeout_error',
          message: `subscribe: timed out after ${timeoutMs}ms waiting for request ${requestId}.`,
        });
      }

      const status = await queue.status(requestId, signal);
      options.onQueueUpdate?.(status);

      if ((TERMINAL_STATUSES as readonly string[]).includes(status.status)) {
        return queue.result(requestId, signal);
      }

      await sleep(pollIntervalMs, signal);
    }
  }

  const models: ClipiaClient['models'] = {
    async list(signal) {
      const { data } = await request<ModelList>('/v1/models', {
        method: 'GET',
        signal,
      });
      return data;
    },
    async get(slug, signal) {
      const { data } = await request<ModelDetail>(
        `/v1/models/${encodeURIComponent(slug)}`,
        { method: 'GET', signal },
      );
      return data;
    },
    async estimate(slug, input, signal) {
      if (typeof input !== 'object' || input === null) {
        throw new TypeError('models.estimate: `input` object is required.');
      }
      const { data } = await request<EstimateResponse>(
        `/v1/models/${encodeURIComponent(slug)}/estimate`,
        { method: 'POST', body: { input }, signal },
      );
      return data;
    },
  };

  const account: ClipiaClient['account'] = {
    async get(signal) {
      const { data } = await request<Account>('/v1/account', {
        method: 'GET',
        signal,
      });
      return data;
    },
  };

  return { queue, subscribe, models, account };
}
