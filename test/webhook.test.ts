import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyWebhookSignature } from '../src/index.js';

const SECRET = 'whsec_test_secret';

function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
}

function headerFor(timestamp: number, signature: string): Record<string, string> {
  return {
    'X-Clipia-Webhook-Id': '7f3a-delivery',
    'X-Clipia-Timestamp': String(timestamp),
    'X-Clipia-Signature': `t=${timestamp},v1=${signature}`,
  };
}

const NOW_MS = 1_717_243_200_000;
const NOW_S = NOW_MS / 1000;
const BODY = JSON.stringify({ request_id: 'req-1', status: 'OK' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('verifyWebhookSignature', () => {
  it('accepts a valid, fresh signature (plain header object)', () => {
    const sig = sign(SECRET, NOW_S, BODY);
    const ok = verifyWebhookSignature({
      secret: SECRET,
      headers: headerFor(NOW_S, sig),
      body: BODY,
    });
    expect(ok).toBe(true);
  });

  it('accepts a valid signature via a Headers instance (case-insensitive)', () => {
    const sig = sign(SECRET, NOW_S, BODY);
    const headers = new Headers();
    headers.set('x-clipia-signature', `t=${NOW_S},v1=${sig}`);
    const ok = verifyWebhookSignature({ secret: SECRET, headers, body: BODY });
    expect(ok).toBe(true);
  });

  it('accepts a Buffer body identical to the signed string', () => {
    const sig = sign(SECRET, NOW_S, BODY);
    const ok = verifyWebhookSignature({
      secret: SECRET,
      headers: headerFor(NOW_S, sig),
      body: Buffer.from(BODY, 'utf8'),
    });
    expect(ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = sign(SECRET, NOW_S, BODY);
    const ok = verifyWebhookSignature({
      secret: SECRET,
      headers: headerFor(NOW_S, sig),
      body: BODY + 'x',
    });
    expect(ok).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const sig = sign('wrong_secret', NOW_S, BODY);
    const ok = verifyWebhookSignature({
      secret: SECRET,
      headers: headerFor(NOW_S, sig),
      body: BODY,
    });
    expect(ok).toBe(false);
  });

  it('rejects a stale timestamp beyond the default tolerance (300s)', () => {
    const stale = NOW_S - 600;
    const sig = sign(SECRET, stale, BODY);
    const ok = verifyWebhookSignature({
      secret: SECRET,
      headers: headerFor(stale, sig),
      body: BODY,
    });
    expect(ok).toBe(false);
  });

  it('honors a custom toleranceSeconds window', () => {
    const stale = NOW_S - 120;
    const sig = sign(SECRET, stale, BODY);
    const within = verifyWebhookSignature({
      secret: SECRET,
      headers: headerFor(stale, sig),
      body: BODY,
      toleranceSeconds: 300,
    });
    const outside = verifyWebhookSignature({
      secret: SECRET,
      headers: headerFor(stale, sig),
      body: BODY,
      toleranceSeconds: 60,
    });
    expect(within).toBe(true);
    expect(outside).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    const ok = verifyWebhookSignature({
      secret: SECRET,
      headers: { 'X-Clipia-Timestamp': String(NOW_S) },
      body: BODY,
    });
    expect(ok).toBe(false);
  });

  it('rejects a malformed signature header (no v1)', () => {
    const ok = verifyWebhookSignature({
      secret: SECRET,
      headers: { 'X-Clipia-Signature': `t=${NOW_S}` },
      body: BODY,
    });
    expect(ok).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    const sig = sign(SECRET, NOW_S, BODY);
    const ok = verifyWebhookSignature({
      secret: '',
      headers: headerFor(NOW_S, sig),
      body: BODY,
    });
    expect(ok).toBe(false);
  });

  it('rejects a non-hex v1 signature without throwing', () => {
    const ok = verifyWebhookSignature({
      secret: SECRET,
      headers: { 'X-Clipia-Signature': `t=${NOW_S},v1=not-hex-zzzz` },
      body: BODY,
    });
    expect(ok).toBe(false);
  });
});
