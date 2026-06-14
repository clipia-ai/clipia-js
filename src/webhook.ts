/**
 * Webhook signature verification for Clipia delivery callbacks.
 *
 * Each delivery is signed with HMAC-SHA256 over `"{timestamp}.{rawBody}"`.
 * Headers carried by the request:
 *
 * ```
 * X-Clipia-Webhook-Id: <delivery uuid>
 * X-Clipia-Timestamp:  1717243200
 * X-Clipia-Signature:  t=1717243200,v1=<hex hmac>
 * ```
 *
 * Uses `node:crypto` for the HMAC + a timing-safe comparison. This keeps the
 * SDK core dependency-free while remaining usable across Node-compatible
 * runtimes (Node, Bun, Deno's node compat).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { GenerationOutput } from './types.js';

const DEFAULT_TOLERANCE_SECONDS = 300;

/** Decoded webhook body delivered to the customer's `webhook_url`. */
export interface WebhookPayload {
  request_id: string;
  /** `OK` on success, `ERROR` on failure. */
  status: 'OK' | 'ERROR' | string;
  payload?: {
    model?: string;
    output?: GenerationOutput;
    cost?: number;
  };
  error?: { code: string; message: string };
}

/** Options for {@link verifyWebhookSignature}. */
export interface VerifyWebhookOptions {
  /** Webhook signing secret from the Clipia dashboard. */
  secret: string;
  /**
   * Incoming request headers. Header names are matched case-insensitively, so
   * Node `IncomingHttpHeaders`, a `Headers` instance, or a plain object work.
   */
  headers:
    | Headers
    | Record<string, string | string[] | undefined>;
  /** The exact raw request body bytes (do NOT re-serialize parsed JSON). */
  body: string | Uint8Array;
  /**
   * Maximum allowed age of the signature timestamp, in seconds. Default 300.
   */
  toleranceSeconds?: number;
}

/** Read a header value case-insensitively from either Headers or an object. */
function getHeader(
  headers: VerifyWebhookOptions['headers'],
  name: string,
): string | undefined {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = (headers as Record<string, string | string[] | undefined>)[
        key
      ];
      if (Array.isArray(value)) return value[0];
      return value ?? undefined;
    }
  }
  return undefined;
}

/** Parse `t=...,v1=...` into a map. Tolerant of whitespace and extra parts. */
function parseSignatureHeader(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

/** Compare two hex strings in constant time; returns false on length mismatch. */
function timingSafeHexEqual(a: string, b: string): boolean {
  // Decode hex into bytes; bail out (false) on malformed input.
  const bufA = hexToBytes(a);
  const bufB = hexToBytes(b);
  if (!bufA || !bufB || bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function hexToBytes(hex: string): Buffer | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    return null;
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Verify a Clipia webhook signature.
 *
 * Validates both the HMAC-SHA256 signature (timing-safe) and the freshness of
 * the timestamp (replay protection). Returns `true` only when both checks pass.
 *
 * @example
 * ```ts
 * import { verifyWebhookSignature } from '@clipia/client/webhook';
 *
 * app.post('/clipia/webhook', (req, res) => {
 *   const ok = verifyWebhookSignature({
 *     secret: process.env.CLIPIA_WEBHOOK_SECRET!,
 *     headers: req.headers,
 *     body: req.rawBody, // raw bytes, not parsed JSON
 *   });
 *   if (!ok) return res.status(401).end();
 *   res.status(200).end();
 * });
 * ```
 */
export function verifyWebhookSignature(options: VerifyWebhookOptions): boolean {
  const { secret, headers, body } = options;
  if (!secret) return false;

  const sigHeader = getHeader(headers, 'X-Clipia-Signature');
  if (!sigHeader) return false;

  const parts = parseSignatureHeader(sigHeader);
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;

  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return false;

  // Freshness / replay-window check.
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Date.now() / 1000;
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    return false;
  }

  const rawBody =
    typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
  const signedPayload = `${t}.${rawBody}`;
  const expected = createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  return timingSafeHexEqual(v1, expected);
}
