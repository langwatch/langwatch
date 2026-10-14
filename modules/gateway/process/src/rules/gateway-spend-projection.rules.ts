/**
 * What the gatewaySpend fold stamps and defaults: the projection's schema version and the
 * usage a request that measured nothing carries.
 */
import type { SpendUsage } from "@langwatch/gateway-contract";

/**
 * Schema-snapshot version of the gatewaySpend fold, stamped on the projected
 * row. The read-back only trusts the current stamp, so an older-shape row
 * refolds from the event log instead of decoding wrong column defaults.
 */
export const GATEWAY_SPEND_PROJECTION_VERSION_LATEST = "2026-07-29";

/** Every quantity at zero: what a request that measured nothing carries. */
export const EMPTY_SPEND_USAGE: SpendUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_creation_1h_tokens: 0,
  reasoning_tokens: 0,
  input_audio_tokens: 0,
  output_audio_tokens: 0,
  input_chars: 0,
  audio_ms: 0,
  input_image_tokens: 0,
  output_image_tokens: 0,
  image_count: 0,
};
