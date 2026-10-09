/**
 * Public type definitions for the Clipia API.
 *
 * Mirrors `docs/projects/public-api/API_REFERENCE.md`. All shapes use the
 * wire format (snake_case fields) returned by `https://api.clipia.ai/v1/*`.
 */

/**
 * Lifecycle status of a generation request.
 *
 * `CANCELED` is terminal: a generation can be canceled out-of-band (e.g. from
 * the Clipia web UI) — the public API has no cancel endpoint, but `status` may
 * still report `CANCELED`, so clients must treat it as a terminal outcome.
 */
export type GenerationStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

/** Terminal statuses — no further polling required once reached. */
export const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELED"] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/** Arbitrary, model-specific generation input (see `GET /v1/models/{slug}`). */
export interface GenerationInput {
  /** Text prompt for text-to-* models. */
  prompt?: string;
  /** Input image URL for image-to-* models. */
  image_url?: string;
  /** Multiple input images for multi-reference models. */
  image_urls?: string[];
  /** Aspect ratio, e.g. `16:9`, `1:1`, `9:16`. */
  aspect_ratio?: string;
  /** Video duration in seconds (video models). */
  duration?: number;
  /** Output resolution, e.g. `720p`, `1080p`, `4k`. */
  resolution?: string;
  /** Any additional model-specific parameters. */
  [key: string]: unknown;
}

/** Options accepted by `queue.submit` / `subscribe`. */
export interface SubmitOptions {
  /** Model-specific generation parameters. */
  input: GenerationInput;
  /** Optional URL to receive a POST webhook when the generation completes. */
  webhookUrl?: string;
  /**
   * Idempotency key (UUID v4). Generated once per call when omitted; every
   * internal retry of that call reuses it, so a transient failure never
   * enqueues or charges twice. Pass your own key to make *your* retries
   * (a second `submit` for the same order) resolve to the same request.
   */
  idempotencyKey?: string;
  /** Per-request AbortSignal. */
  signal?: AbortSignal;
}

/** Response of `POST /v1/models/{model}` (enqueue). */
export interface SubmitResponse {
  request_id: string;
  status: GenerationStatus;
  queue_position?: number;
  status_url: string;
  response_url: string;
  /** Fixed credit cost reserved for this operation. */
  cost?: number;
}

/** Response of `GET /v1/requests/{id}/status`. */
export interface StatusResponse {
  request_id: string;
  status: GenerationStatus;
  queue_position?: number | null;
  /** Progress 0–100 while `IN_PROGRESS`. */
  progress?: number;
  logs?: unknown[];
}

/** A single produced image. */
export interface OutputImage {
  /** Optimized delivery URL (typically WebP) — best for display. */
  url: string;
  /** Full-quality original (PNG/JPG) when available — use for downloads. */
  original_url?: string;
  width?: number;
  height?: number;
}

/** A produced video. */
export interface OutputVideo {
  url: string;
  /** Full-quality original when available. */
  original_url?: string;
  /** Poster frame from the provider — lets you render a preview without downloading the video. */
  thumbnail_url?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/** A produced audio track (text-to-speech and music models). */
export interface OutputAudio {
  /** CDN URL of the audio file (MP3 for speech and music). */
  url: string;
  /** Container format derived from the file (`mp3`, `wav`, …); may be absent. */
  format?: string;
}

/**
 * Output payload of a completed generation.
 *
 * Note: the webhook delivery carries a slimmer shape than `GET /v1/requests/{id}` —
 * `original_url` is not included there. Fetch the result by `request_id` when the
 * full-quality original is needed.
 */
export interface GenerationOutput {
  images?: OutputImage[];
  video?: OutputVideo;
  audio?: OutputAudio;
  [key: string]: unknown;
}

/** Sanitized error attached to a FAILED result. */
export interface ResultError {
  code: string;
  message: string;
}

/**
 * Response of `GET /v1/requests/{id}`.
 *
 * Terminal statuses (`COMPLETED`/`FAILED`) come with HTTP 200. Non-terminal
 * statuses come with HTTP 202; the SDK still returns this shape but with
 * `pending: true` set so callers can branch without catching.
 */
export interface ResultResponse {
  request_id: string;
  status: GenerationStatus;
  model?: string;
  output?: GenerationOutput;
  error?: ResultError;
  cost?: number;
  created_at?: string;
  completed_at?: string;
  /** `true` when the API responded 202 (still IN_QUEUE / IN_PROGRESS). */
  pending?: boolean;
}

/** Pricing summary in the model catalog. */
export interface ModelPricing {
  /** Reference quote; absent when authoritative pricing is unavailable. */
  credits?: number;
  billing_unit?: "characters";
  unit_size?: number;
  character_count?: "spoken_text" | "trimmed_text";
  rounding?: "ceil";
  minimum_credits?: number;
  available?: false;
  credits_base?: number;
  multipliers?: Record<string, Record<string, number>>;
  note?: string;
}

/** A model entry in `GET /v1/models`. */
export interface ModelSummary {
  /** OpenAI-compatible id; present when the unified LLM catalog is enabled. */
  id?: string;
  object?: "model";
  created?: number;
  owned_by?: string;
  slug: string;
  type: "image" | "video" | "audio" | string;
  name: string;
  /** Supported capabilities, e.g. `text-to-image`, `image-to-video`, `text-to-speech`. */
  capabilities?: string[];
  pricing?: ModelPricing;
}

/** OpenAI-compatible text model entry in `GET /v1/models`. */
export interface LlmModelSummary {
  id: string;
  canonical_slug: string;
  object: "model";
  name: string;
  created: number;
  owned_by: string;
  description: string;
  context_length: number;
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
  };
  /** USD-per-token decimal strings (OpenAI-compatible catalog format). */
  pricing: { prompt?: string; completion?: string };
  top_provider: {
    context_length: number;
    max_completion_tokens: number;
    is_moderated: boolean;
  };
  supported_parameters: string[];
  per_request_limits: null;
}

/** Response of `GET /v1/models`. */
export interface ModelList {
  object?: "list";
  data: Array<ModelSummary | LlmModelSummary>;
}

/** Response of `POST /v1/models/{model}/estimate`. */
export interface EstimateResponse {
  /** Deterministic credit cost for the given `input` on this model. */
  credits: number;
}

/** A single field in a model input schema. */
export interface ModelInputField {
  type: string;
  required?: boolean;
  enum?: (string | number)[];
  default?: unknown;
}

/** Model input descriptor in the canonical parameter list. */
export interface ModelInputParameter extends ModelInputField {
  name: string;
  label?: string;
  hint?: string;
  options?: Array<{ value: string | number; label: string }>;
  validation?: {
    minLength?: number;
    maxLength?: number;
    [key: string]: unknown;
  };
  min?: number;
  max?: number;
  step?: number;
  minLength?: number;
  maxLength?: number;
}

export interface ModelInputSchema {
  parameters: ModelInputParameter[];
  parameterGroups?: Array<Record<string, unknown>>;
}

/**
 * Character bounds of the narration text for a text-to-speech model.
 *
 * The text travels in `input.prompt`; the catalog also describes it in
 * `input_schema.parameters`. A request outside these bounds is rejected with 400 before the generation is
 * created, which means no credits are reserved.
 */
export interface ModelTextLimits {
  min_chars: number;
  max_chars: number;
}

/** Response of `GET /v1/models/{slug}` (full schema). */
export interface ModelDetail extends ModelSummary {
  input_schema?: ModelInputSchema | null;
  /** Text-to-speech models only. */
  text_limits?: ModelTextLimits;
}

/** `GET /v1/models/{slug}` returns either generation or text-model details. */
export type AnyModelDetail = ModelDetail | LlmModelSummary;

/** Response of `GET /v1/account`. */
export interface Account {
  account_id: string;
  balance: { credits: number };
  usage_30d: { requests: number; credits_spent: number };
}

/**
 * Error `type` categories returned by the API (`error.type`). The list is
 * open-ended on the wire — treat unknown values as `api_error`.
 */
export type ApiErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "billing_error"
  | "rate_limit_error"
  | "api_error"
  | (string & {});

/**
 * Machine-readable error codes (`error.code`). `concurrency_limit_exceeded`
 * and `rate_limit_exceeded` arrive as HTTP 429 with a `Retry-After` header;
 * `subscription_required` is a 402 that topping up does NOT fix.
 */
export type ApiErrorCode =
  | "invalid_request"
  | "invalid_api_key"
  | "insufficient_credits"
  | "subscription_required"
  | "insufficient_scope"
  | "not_found"
  | "model_not_found"
  | "idempotency_key_reuse"
  | "request_in_progress"
  | "model_input_invalid"
  | "webhook_url_invalid"
  | "rate_limit_exceeded"
  | "concurrency_limit_exceeded"
  | "internal_error"
  | "service_unavailable"
  | (string & {});

/** Wire format of an API error envelope. */
export interface ApiErrorEnvelope {
  error: {
    type: ApiErrorType;
    code: ApiErrorCode;
    message: string;
  };
}

/** Options for the high-level `subscribe` helper. */
export interface SubscribeOptions extends SubmitOptions {
  /** Called on each poll with the latest status. */
  onQueueUpdate?: (status: StatusResponse) => void;
  /** Poll interval in milliseconds. Default 1000. */
  pollIntervalMs?: number;
  /** Maximum time to wait for a terminal status, in ms. Default 600000. */
  timeoutMs?: number;
}
