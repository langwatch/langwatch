import { HandledError } from "@langwatch/handled-error";
import { type LimitType, limitTypeSchema } from "@langwatch/organization-contract";
import { z } from "zod";

/** The allowance a seat refusal carries in its `meta`. */
const seatLimitMetaSchema = z.object({
  limitType: limitTypeSchema,
  current: z.number(),
  max: z.number(),
});

type SeatLimit = Readonly<{ limitType: LimitType; current: number; max: number }>;

/** Whether an error is a seat refusal, whichever layer raised it, and the seat facts it carries. */
export function readSeatRefusal(
  error: unknown,
): { kind: "seat-limit"; limit: SeatLimit } | { kind: "other" } {
  if (!HandledError.isHandled(error)) return { kind: "other" };
  if (error.code !== "resource_limit_exceeded" && error.code !== "member_seat_limit_reached") {
    return { kind: "other" };
  }

  const meta = seatLimitMetaSchema.safeParse(error.meta);
  return meta.success ? { kind: "seat-limit", limit: meta.data } : { kind: "other" };
}
