/**
 * The wire of `POST /api/gateway/v1/spend-events/replay`, which webhook answers because it
 * reads only webhook's endpoints, emitted log and stream. Moved from gateway's contract
 * unchanged: the path, body, refusals and answer are main's.
 */
import { z } from "zod";

export const WEBHOOK_SPEND_REPLAY_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const WEBHOOK_SPEND_REPLAY_MAX_ENVELOPES = 10_000;
export const WEBHOOK_SPEND_REPLAY_PAGE_SIZE = 200;
/** Salts the batch and inbox-source ids a replay writes; never read back by kind. */
export const WEBHOOK_SPEND_REPLAY_KSUID_RESOURCE = "replay";

export const webhookSpendReplayBodySchema = z
  .object({
    from: z.number().int().positive().safe(),
    to: z.number().int().positive().safe(),
    endpoint_id: z.string().min(1).max(200),
  })
  .refine((b) => b.from <= b.to, {
    message: "from must be less than or equal to to",
  })
  .refine((b) => b.to - b.from <= WEBHOOK_SPEND_REPLAY_MAX_WINDOW_MS, {
    message: "the replay window is capped at 7 days per call",
  });
export type WebhookSpendReplayBody = z.output<typeof webhookSpendReplayBodySchema>;

const webhookSpendReplayResultSchema = z.object({
  endpoint_id: z.string(),
  replay_id: z.string(),
  replayed: z.number().int(),
  window: z.object({ from: z.string(), to: z.string() }),
});

export const webhookSpendReplayResponseSchema = z.object({ data: webhookSpendReplayResultSchema });
export type WebhookSpendReplayResponse = z.infer<typeof webhookSpendReplayResponseSchema>;
