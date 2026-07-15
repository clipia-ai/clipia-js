# clipia

Official TypeScript client and `clipia` CLI for the [Clipia](https://api.clipia.ai)
public API — a queue-based API for AI image and video generation.

The DX mirrors the fal.ai queue flow (`submit → status → result` plus a
high-level `subscribe`), with Clipia-native method names and credit-based
billing.

- Zero runtime dependencies in the SDK core (built on the global `fetch`).
- Dual **ESM + CJS** builds with bundled TypeScript types.
- Built-in **webhook signature verification** (HMAC-SHA256, timing-safe).
- Bundled **CLI** (`clipia`).

> Prefer talking to Clipia from an AI agent (Claude Code / Cursor) instead of
> writing code? Clipia ships a hosted **MCP server** — no SDK required. See
> [Using Clipia via MCP](#using-clipia-via-mcp-claude-code--cursor) below.

## Installation

```bash
npm install clipia-ai
# or: pnpm add clipia-ai / yarn add clipia-ai
```

Requires Node.js 18+ (for the global `fetch`). For older runtimes, pass a
custom `fetch` implementation via `createClient({ apiKey, fetch })`.

## Authentication

Create an API key in the Clipia dashboard (`Settings → API keys`). The key is
shown once. It is sent as `Authorization: Bearer <apiKey>` and is a
**server-side secret** — never ship it in a browser or mobile app.

```ts
import { createClient } from 'clipia-ai';

const clipia = createClient({
  apiKey: process.env.CLIPIA_KEY!,
  // baseUrl: 'https://api.clipia.ai', // optional override
});
```

Keys come in two flavours: `clipia_live_…` (production, charges credits) and
`clipia_test_…` (sandbox — instant mock results, no credits charged). Use a
test key to validate your integration before going live.

## Quickstart

### High-level: `subscribe` (submit + poll until done)

```ts
const result = await clipia.subscribe('nano-banana-2', {
  input: { prompt: 'a sunset over mountains, cinematic' },
  onQueueUpdate: (s) => console.log(s.status, s.progress ?? ''),
  pollIntervalMs: 1000, // default 1000
  timeoutMs: 600_000, // default 600000
});

console.log(result.output?.images?.[0]?.url);
```

`subscribe` enqueues the request, polls `status` until a terminal state
(`COMPLETED` / `FAILED`), then resolves the full result. A `subscribe_timeout`
`ClipiaApiError` is thrown if `timeoutMs` elapses first.

### Low-level: manual queue control

```ts
// Submit. An Idempotency-Key (UUID v4) is generated automatically so that
// network retries never enqueue or charge twice.
const job = await clipia.queue.submit('nano-banana-2', {
  input: { prompt: 'a red panda coding at night' },
  webhookUrl: 'https://your-server.com/clipia/webhook', // optional
  // idempotencyKey: 'your-own-uuid',                    // optional
});

const status = await clipia.queue.status(job.request_id);
// { status: 'IN_PROGRESS', progress: 45, ... }

const result = await clipia.queue.result(job.request_id);
// When still running, the API returns 202; result() returns the shape with
// `pending: true` instead of throwing.
if (result.pending) {
  console.log('still running:', result.status);
}
```

> A generation cannot be canceled: credits are reserved the moment it starts
> and the underlying compute cannot be interrupted. Submit deliberately — and
> use a `clipia_test_…` sandbox key while iterating.

### Models, cost estimate and account

```ts
const { data } = await clipia.models.list(); // text + image/video/audio
const model = await clipia.models.get('seedance-2-fast-t2v');

// Deterministic credit cost for a given input, before you submit.
const { credits } = await clipia.models.estimate('seedance-2-fast-t2v', {
  prompt: 'aerial shot over a neon city',
  duration: 8,
  resolution: '1080p',
});
console.log(`this will cost ${credits} credits`);

const account = await clipia.account.get();
console.log(account.balance.credits);
```

The unified catalog also returns OpenAI/OpenRouter-shaped text models such as
`gpt-5.6-sol`; their entries use `id`, `context_length` and per-token
`pricing`. Use the standard OpenAI SDK with
`baseURL: 'https://api.clipia.ai/v1'` for chat completions.

### Video generation

```ts
const result = await clipia.subscribe('seedance-2-fast-i2v', {
  input: {
    image_url: 'https://example.com/start-frame.jpg',
    prompt: 'slow dolly-in, golden hour',
    duration: 8,
    resolution: '720p',
    aspect_ratio: '16:9',
  },
});
console.log(result.output?.video?.url);
```

## Webhooks

Pass `webhookUrl` on `submit`/`subscribe` and Clipia POSTs the result to your
server when the generation finishes. Verify every delivery with the bundled
helper before trusting it.

```ts
import { verifyWebhookSignature } from 'clipia-ai';
// or: import { verifyWebhookSignature } from 'clipia-ai/webhook';

// Express example — make sure you have the RAW request body.
app.post('/clipia/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const ok = verifyWebhookSignature({
    secret: process.env.CLIPIA_WEBHOOK_SECRET!,
    headers: req.headers, // case-insensitive; Headers or plain object
    body: req.body, // RAW bytes, NOT parsed JSON
    toleranceSeconds: 300, // optional replay window (default 300s)
  });

  if (!ok) return res.status(401).end();

  const event = JSON.parse(req.body.toString('utf8'));
  // event.status is 'OK' (success) or 'ERROR' (failed).
  // Handle event.request_id idempotently; deliveries may repeat.
  res.status(200).end();
});
```

`verifyWebhookSignature` checks both the HMAC-SHA256 signature (timing-safe)
and the freshness of `X-Clipia-Timestamp`. It returns `true` only when both
pass and never throws on malformed input.

## Error handling

Every non-2xx response throws a typed `ClipiaApiError`:

```ts
import { ClipiaApiError } from 'clipia-ai';

try {
  await clipia.queue.submit('nano-banana-2', { input: { prompt: '...' } });
} catch (err) {
  if (err instanceof ClipiaApiError) {
    console.error(err.status); // 402
    console.error(err.code); // 'insufficient_credits'
    console.error(err.type); // 'invalid_request_error'
    console.error(err.message);
  }
}
```

| HTTP | `code` | Meaning |
| ---- | ------ | ------- |
| 400 | `invalid_request` | invalid body/params |
| 401 | `invalid_api_key` | missing/invalid/revoked key |
| 402 | `insufficient_credits` | not enough credits |
| 403 | `insufficient_scope` | key lacks the required scope |
| 404 | `not_found` | unknown `request_id` / model |
| 409 | `idempotency_key_reuse` / `request_in_progress` | idempotency conflict |
| 422 | `model_input_invalid` | params don't match the model |
| 429 | `rate_limit_exceeded` | rate limit hit (`Retry-After`) |
| 5xx | `internal_error` / `service_unavailable` | retry with backoff |

Network/connection failures throw `ClipiaApiError` with `status: 0` and
`code: 'network_error'`.

## CLI

The package ships a `clipia` binary. Auth resolves from `--key` or the
`CLIPIA_KEY` environment variable. All commands print JSON to stdout.

```bash
export CLIPIA_KEY=clipia_live_xxxxxxxx

# Submit (returns request_id immediately)
clipia generate nano-banana-2 --input '{"prompt":"a sunset over mountains"}'

# Submit and wait for the final result
clipia generate nano-banana-2 --input '{"prompt":"a sunset"}' --wait

# Submit with a webhook
clipia generate nano-banana-2 --input '{"prompt":"x"}' --webhook https://you/cb

clipia status   <request_id>
clipia result   <request_id>
clipia estimate nano-banana-2 --input '{"prompt":"x","aspect_ratio":"16:9"}'
clipia models                 # list all models
clipia models nano-banana-2   # one model's schema
clipia account                # balance + 30-day usage
```

Global flags: `--key <key>`, `--base-url <url>`.

> Security: `--key` is convenient but **insecure on shared hosts** — it is
> visible to other users via the process list (`ps`). Prefer the `CLIPIA_KEY`
> environment variable in any multi-user or CI environment.

## API surface

```ts
import {
  createClient,
  ClipiaApiError,
  verifyWebhookSignature,
  VERSION,
} from 'clipia-ai';

const clipia = createClient({ apiKey, baseUrl?, fetch? });

clipia.queue.submit(model, { input, webhookUrl?, idempotencyKey?, signal? });
clipia.queue.status(requestId, signal?);
clipia.queue.result(requestId, signal?);
clipia.subscribe(model, { input, onQueueUpdate?, pollIntervalMs?, timeoutMs?, ... });
clipia.models.list(signal?);
clipia.models.get(slug, signal?);
clipia.models.estimate(slug, input, signal?);
clipia.account.get(signal?);
```

## Using Clipia via MCP (Claude Code / Cursor)

Clipia hosts a remote **Model Context Protocol** server, so an AI coding agent
can generate images/video, poll results, list models, search prompt templates
and read your balance directly — **no SDK or code required**. The server is
stateless Streamable HTTP at `https://mcp.clipia.ai/mcp` and authenticates with
the same API key (as a Bearer token).

Tools exposed: `generate_image`, `generate_video`, `wait_generation`,
`get_generation`, `list_models`, `get_model`, `get_balance`, `search_templates`.

### Claude Code

```bash
claude mcp add --transport http clipia https://mcp.clipia.ai/mcp \
  --header "Authorization: Bearer clipia_live_xxxxxxxx"
```

### Cursor

Add to `~/.cursor/mcp.json` (or the project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "clipia": {
      "url": "https://mcp.clipia.ai/mcp",
      "headers": {
        "Authorization": "Bearer clipia_live_xxxxxxxx"
      }
    }
  }
}
```

Use a `clipia_test_…` key first to exercise the integration with instant mock
results and no credit charges.

## Development

```bash
npm install
npm run build      # tsup → dist (ESM + CJS + .d.ts + CLI)
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

## License

MIT — see [LICENSE](./LICENSE).
