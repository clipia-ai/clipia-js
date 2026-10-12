# Changelog — clipia-ai (TypeScript)

## Unreleased

- Types: `GenerationOutput.audios` (every audio track — music models return
  several variants; the first equals `audio`), `ModelPricing.estimate_required`
  (the price depends on the input: call `estimate`), `ResultResponse.cost`
  documented as the charged amount (0 for `FAILED` / `CANCELED`).

## 1.3.0 — 2026-10-09

- `queue.submit` / `subscribe` retry transient failures (network error, 429,
  500/502/503/504) up to `maxRetries` times (default 2) reusing **one**
  `Idempotency-Key` per call, so a retry never enqueues or charges twice.
  `Retry-After` is honored; otherwise capped exponential backoff seeded by
  `retryDelayMs` (default 500). Both knobs live in `createClient({...})`;
  `maxRetries: 0` restores the previous behaviour.
- CLI: `clipia generate --idempotency-key <key>`.
- Types: `ApiErrorType` / `ApiErrorCode` unions (incl. `subscription_required`,
  `concurrency_limit_exceeded`, `webhook_url_invalid`, `model_not_found`),
  `ModelSummary.type` includes `audio`, `OutputAudio` documented as MP3.
- README: speech and music example, idempotency and retries section, error
  table, audio catalog fields, MCP tool list with `generate_audio` /
  `generate_music`.

Not published yet.
