import { z } from "zod";

/**
 * One request's outcome joined with who it is billed to: what the debit
 * writer turns into one ledger row per applicable budget. Stashed verbatim in
 * `gatewayDebits` state, so every field added after the first deploy defaults.
 */
export const writeGatewayDebitsSchema = z.object({
  gateway_request_id: z.string(),
  project_id: z.string(),
  organization_id: z.string(),
  team_id: z.string().default(""),
  virtual_key_id: z.string(),
  principal_user_id: z.string().default(""),
  end_user_id: z.string().default(""),
  model: z.string(),
  model_provider_id: z.string(),
  usage: z
    .object({
      input_tokens: z.number().int().min(0),
      output_tokens: z.number().int().min(0),
      cache_read_input_tokens: z.number().int().min(0),
      cache_creation_input_tokens: z.number().int().min(0),
      cache_creation_1h_tokens: z.number().int().min(0).default(0),
      reasoning_tokens: z.number().int().min(0),
      input_audio_tokens: z.number().int().min(0).default(0),
      output_audio_tokens: z.number().int().min(0).default(0),
      input_chars: z.number().int().min(0).default(0),
      audio_ms: z.number().int().min(0).default(0),
      input_image_tokens: z.number().int().min(0).default(0),
      output_image_tokens: z.number().int().min(0).default(0),
      image_count: z.number().int().min(0).default(0),
    })
    .nullable(),
  cost_nano_usd: z.number().int().min(0),
  rate_version: z.string(),
  status: z.enum(["confirmed", "failed"]),
  error_type: z.string().default(""),
  duration_ms: z.number().int().min(0),
  occurred_at: z.number().int().positive(),
});

export type WriteGatewayDebitsPayload = z.infer<typeof writeGatewayDebitsSchema>;
