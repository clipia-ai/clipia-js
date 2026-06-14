import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClipiaApiError,
  createClient,
  type ClipiaClient,
} from '../src/index.js';

const API_KEY = 'clipia_live_testkey';
const BASE_URL = 'https://api.clipia.ai';

/** Build a Response-like object for the mocked fetch. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

let fetchMock: FetchMock;
let client: ClipiaClient;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  client = createClient({ apiKey: API_KEY });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Extract the [url, init] of the Nth fetch call. */
function callArgs(n = 0): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[n]!;
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

describe('createClient', () => {
  it('throws when apiKey is missing', () => {
    // @ts-expect-error intentionally invalid
    expect(() => createClient({})).toThrow(TypeError);
  });

  it('strips a trailing slash from a custom baseUrl', async () => {
    const c = createClient({ apiKey: API_KEY, baseUrl: 'https://x.test/' });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    await c.models.list();
    expect(callArgs().url).toBe('https://x.test/v1/models');
  });
});

describe('queue.submit', () => {
  it('sends Authorization: Bearer, auto Idempotency-Key, and a JSON body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        request_id: 'req-1',
        status: 'IN_QUEUE',
        queue_position: 0,
        status_url: 'a',
        response_url: 'b',
        cost: 12,
      }),
    );

    const res = await client.queue.submit('nano-banana-2', {
      input: { prompt: 'a sunset' },
    });

    expect(res.request_id).toBe('req-1');
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE_URL}/v1/models/nano-banana-2`);
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    // Auto UUID v4 idempotency key.
    expect(headers['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    expect(JSON.parse(init.body as string)).toEqual({
      input: { prompt: 'a sunset' },
    });
  });

  it('honors an explicit idempotencyKey and serializes webhookUrl as webhook_url', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { request_id: 'r', status: 'IN_QUEUE', status_url: '', response_url: '' }),
    );

    await client.queue.submit('nano-banana-2', {
      input: { prompt: 'x' },
      idempotencyKey: 'fixed-key-123',
      webhookUrl: 'https://hook.test/cb',
    });

    const { init } = callArgs();
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('fixed-key-123');
    expect(JSON.parse(init.body as string)).toEqual({
      input: { prompt: 'x' },
      webhook_url: 'https://hook.test/cb',
    });
  });

  it('rejects when input is not an object', async () => {
    // @ts-expect-error intentionally invalid
    await expect(client.queue.submit('m', {})).rejects.toThrow(TypeError);
  });
});

describe('queue.status', () => {
  it('maps the status response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        request_id: 'req-1',
        status: 'IN_PROGRESS',
        queue_position: null,
        progress: 45,
        logs: [],
      }),
    );

    const status = await client.queue.status('req-1');
    expect(status.status).toBe('IN_PROGRESS');
    expect(status.progress).toBe(45);
    expect(callArgs().url).toBe(`${BASE_URL}/v1/requests/req-1/status`);
    expect(callArgs().init.method).toBe('GET');
  });
});

describe('queue.result', () => {
  it('maps a COMPLETED 200 result with pending=false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        request_id: 'req-1',
        status: 'COMPLETED',
        model: 'nano-banana-2',
        output: { images: [{ url: 'https://media.clipia.ai/a.png', width: 1024, height: 1024 }] },
        cost: 12,
      }),
    );

    const result = await client.queue.result('req-1');
    expect(result.status).toBe('COMPLETED');
    expect(result.pending).toBe(false);
    expect(result.output?.images?.[0]?.url).toBe('https://media.clipia.ai/a.png');
    expect(callArgs().url).toBe(`${BASE_URL}/v1/requests/req-1`);
  });

  it('returns pending=true on a 202 instead of throwing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(202, { request_id: 'req-1', status: 'IN_PROGRESS' }),
    );

    const result = await client.queue.result('req-1');
    expect(result.pending).toBe(true);
    expect(result.status).toBe('IN_PROGRESS');
  });
});

describe('models.estimate', () => {
  it('POSTs /v1/models/{slug}/estimate with the input and returns credits', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { credits: 12 }));

    const res = await client.models.estimate('nano-banana-2', {
      prompt: 'a sunset',
      aspect_ratio: '16:9',
    });

    expect(res.credits).toBe(12);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE_URL}/v1/models/nano-banana-2/estimate`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      input: { prompt: 'a sunset', aspect_ratio: '16:9' },
    });
  });
});

describe('subscribe', () => {
  it('polls until COMPLETED and resolves the result', async () => {
    fetchMock
      // submit
      .mockResolvedValueOnce(
        jsonResponse(200, {
          request_id: 'req-9',
          status: 'IN_QUEUE',
          queue_position: 1,
          status_url: '',
          response_url: '',
        }),
      )
      // status poll 1
      .mockResolvedValueOnce(jsonResponse(200, { request_id: 'req-9', status: 'IN_QUEUE', queue_position: 0 }))
      // status poll 2
      .mockResolvedValueOnce(jsonResponse(200, { request_id: 'req-9', status: 'IN_PROGRESS', progress: 50 }))
      // status poll 3 -> terminal
      .mockResolvedValueOnce(jsonResponse(200, { request_id: 'req-9', status: 'COMPLETED' }))
      // result
      .mockResolvedValueOnce(
        jsonResponse(200, {
          request_id: 'req-9',
          status: 'COMPLETED',
          output: { images: [{ url: 'https://media.clipia.ai/x.png' }] },
          cost: 12,
        }),
      );

    const updates: string[] = [];
    const out = await client.subscribe('nano-banana-2', {
      input: { prompt: 'cat' },
      pollIntervalMs: 1,
      onQueueUpdate: (s) => updates.push(s.status),
    });

    expect(out.status).toBe('COMPLETED');
    expect(out.output?.images?.[0]?.url).toBe('https://media.clipia.ai/x.png');
    // initial enqueue update + 3 status polls.
    expect(updates).toEqual(['IN_QUEUE', 'IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']);
    // submit + 3 status + result = 5 calls.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('fetches the result even when terminal status is FAILED', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { request_id: 'req-f', status: 'IN_QUEUE', status_url: '', response_url: '' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { request_id: 'req-f', status: 'FAILED' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          request_id: 'req-f',
          status: 'FAILED',
          error: { code: 'GENERATION_FAILED', message: 'boom' },
        }),
      );

    const out = await client.subscribe('m', { input: { prompt: 'x' }, pollIntervalMs: 1 });
    expect(out.status).toBe('FAILED');
    expect(out.error?.code).toBe('GENERATION_FAILED');
  });

  it('throws a subscribe_timeout ClipiaApiError when the deadline passes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { request_id: 'req-t', status: 'IN_QUEUE', status_url: '', response_url: '' }),
      )
      // Fresh Response per call: a Response body can only be read once.
      .mockImplementation(async () =>
        jsonResponse(200, { request_id: 'req-t', status: 'IN_PROGRESS', progress: 10 }),
      );

    await expect(
      client.subscribe('m', { input: { prompt: 'x' }, pollIntervalMs: 1, timeoutMs: 5 }),
    ).rejects.toMatchObject({ name: 'ClipiaApiError', code: 'subscribe_timeout' });
  });
});

describe('models & account', () => {
  it('models.list hits /v1/models', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ slug: 'a', type: 'image', name: 'A' }] }));
    const res = await client.models.list();
    expect(res.data[0]?.slug).toBe('a');
    expect(callArgs().url).toBe(`${BASE_URL}/v1/models`);
  });

  it('models.get hits /v1/models/{slug}', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { slug: 'nano-banana-2', type: 'image', name: 'NB2' }));
    const res = await client.models.get('nano-banana-2');
    expect(res.slug).toBe('nano-banana-2');
    expect(callArgs().url).toBe(`${BASE_URL}/v1/models/nano-banana-2`);
  });

  it('account.get hits /v1/account', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        account_id: 'acc',
        balance: { credits: 1840 },
        usage_30d: { requests: 512, credits_spent: 6120 },
      }),
    );
    const res = await client.account.get();
    expect(res.balance.credits).toBe(1840);
    expect(callArgs().url).toBe(`${BASE_URL}/v1/account`);
  });
});

describe('error mapping', () => {
  it('maps a 401 envelope to ClipiaApiError with code/type/status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: { type: 'authentication_error', code: 'invalid_api_key', message: 'bad key' },
      }),
    );

    const err = await client.account.get().catch((e) => e);
    expect(err).toBeInstanceOf(ClipiaApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_api_key');
    expect(err.type).toBe('authentication_error');
    expect(err.message).toBe('bad key');
  });

  it('maps a 402 insufficient_credits on submit', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(402, {
        error: { type: 'invalid_request_error', code: 'insufficient_credits', message: 'no credits' },
      }),
    );

    const err = await client.queue
      .submit('m', { input: { prompt: 'x' } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ClipiaApiError);
    expect(err.status).toBe(402);
    expect(err.code).toBe('insufficient_credits');
  });

  it('wraps network failures into a network_error ClipiaApiError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const err = await client.models.list().catch((e) => e);
    expect(err).toBeInstanceOf(ClipiaApiError);
    expect(err.code).toBe('network_error');
    expect(err.status).toBe(0);
  });

  it('does not leak the request path in the network error message', async () => {
    const c = createClient({ apiKey: API_KEY, baseUrl: 'https://internal-host.local' });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const err = await c.models.get('secret-slug').catch((e) => e);
    expect(err).toBeInstanceOf(ClipiaApiError);
    expect(err.message).toBe('Network request failed: fetch failed');
    expect(err.message).not.toContain('/v1/models');
    expect(err.message).not.toContain('secret-slug');
    expect(err.message).not.toContain('internal-host.local');
  });
});

describe('URL encoding & idempotency key generation', () => {
  it('URL-encodes the model slug in the submit path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { request_id: 'r', status: 'IN_QUEUE', status_url: '', response_url: '' }),
    );
    await client.queue.submit('weird/slug x', { input: { prompt: 'p' } });
    expect(callArgs().url).toBe(`${BASE_URL}/v1/models/weird%2Fslug%20x`);
  });

  it('URL-encodes the request id in the status path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { request_id: 'r', status: 'IN_PROGRESS' }),
    );
    await client.queue.status('id/with space');
    expect(callArgs().url).toBe(`${BASE_URL}/v1/requests/id%2Fwith%20space/status`);
  });

  it('throws when no secure crypto is available (no Math.random fallback)', async () => {
    // Remove crypto entirely so the UUID generator must fail loudly rather
    // than degrade to a weak PRNG for the idempotency key.
    vi.stubGlobal('crypto', undefined);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { request_id: 'r', status: 'IN_QUEUE', status_url: '', response_url: '' }),
    );
    await expect(
      client.queue.submit('m', { input: { prompt: 'x' } }),
    ).rejects.toThrow(/Secure crypto .* is not available/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
