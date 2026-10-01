import { z } from "zod";

import {
  joinMatchKindSchema,
  joinResolverSchema,
  joinWithdrawalCauseSchema,
} from "./join-request.ts";
import { identityActorSchema } from "./vocabulary.ts";

/** Join-request commands for the full lifecycle: request, approve, reject, withdraw, expire. Each
 * carries a caller-minted commandId for idempotency, not PII. See ADR-117 D12.
 */

export const REQUEST_JOIN_COMMAND_TYPE = "lw.identity.request_join" as const;
export const APPROVE_JOIN_COMMAND_TYPE = "lw.identity.approve_join" as const;
export const REJECT_JOIN_COMMAND_TYPE = "lw.identity.reject_join" as const;
export const WITHDRAW_JOIN_COMMAND_TYPE = "lw.identity.withdraw_join" as const;
export const EXPIRE_JOIN_COMMAND_TYPE = "lw.identity.expire_join" as const;

export const JOIN_REQUEST_COMMAND_TYPES = [
  REQUEST_JOIN_COMMAND_TYPE,
  APPROVE_JOIN_COMMAND_TYPE,
  REJECT_JOIN_COMMAND_TYPE,
  WITHDRAW_JOIN_COMMAND_TYPE,
  EXPIRE_JOIN_COMMAND_TYPE,
] as const;
export type JoinRequestCommandType = (typeof JOIN_REQUEST_COMMAND_TYPES)[number];

const commandIdentitySchema = z.object({
  /** The ORGANIZATION is the tenant of its join requests' history — the
   *  people who READ a request are its admins, so an organization's requests
   *  are one tenant's history and support can read them in one tenant scan. */
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  /** The aggregate. One request, one history, one lane. */
  joinRequestId: z.string().min(1),
  commandId: z.string().min(1),
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
});

/**
 * Every join-request command enforces `tenantId === organizationId`. Wiring
 * them differently would fold events into another organization's
 * projection undetectably downstream — refused at the wire boundary.
 */
function commandDataSchema<Shape extends z.ZodRawShape>(
  shape: Shape,
): z.ZodType<
  z.output<z.ZodObject<z.core.util.Writeable<typeof commandIdentitySchema.shape & Shape>>>
> {
  return z.object({ ...commandIdentitySchema.shape, ...shape }).refine(
    (data) => {
      // zod 4 widens the spread object's output under a generic shape to a union that
      // no longer names the base's own keys, so the fields this reads are named
      // here rather than inferred. They come from `commandIdentitySchema`, never
      // from `shape`, so they are always present whatever a caller extends with.
      const { tenantId, organizationId } = data as z.infer<typeof commandIdentitySchema>;
      return tenantId === organizationId;
    },
    {
      message: "tenantId must equal organizationId: one join-request history per organization",
      path: ["tenantId"],
    },
  );
}

export const requestJoinCommandDataSchema = commandDataSchema({
  userId: z.string().min(1),
  /** Already normalized by the matcher; the guard normalizes again rather
   *  than trust a caller, and only the normalized form reaches a fact. */
  domain: z.string().min(1),
  matchedVia: joinMatchKindSchema,
  expiresAtMs: z.number().int().nonnegative(),
  /** False only for a policy approval, which nobody has to act on. */
  notifyAdmins: z.boolean().default(true),
});
export type RequestJoinCommandData = z.infer<typeof requestJoinCommandDataSchema>;

export const approveJoinCommandDataSchema = commandDataSchema({
  resolvedBy: joinResolverSchema,
});
export type ApproveJoinCommandData = z.infer<typeof approveJoinCommandDataSchema>;

export const rejectJoinCommandDataSchema = commandDataSchema({
  resolvedBy: joinResolverSchema,
});
export type RejectJoinCommandData = z.infer<typeof rejectJoinCommandDataSchema>;

export const withdrawJoinCommandDataSchema = commandDataSchema({
  cause: joinWithdrawalCauseSchema,
});
export type WithdrawJoinCommandData = z.infer<typeof withdrawJoinCommandDataSchema>;

export const expireJoinCommandDataSchema = commandDataSchema({
  /** The slot the wake was scheduled for — business time for the command, so
   *  a lagged wake expires the request at the deadline it promised rather
   *  than whenever the worker got round to it. */
  scheduledFor: z.number().int().nonnegative(),
});
export type ExpireJoinCommandData = z.infer<typeof expireJoinCommandDataSchema>;

export type JoinRequestCommand =
  | { type: typeof REQUEST_JOIN_COMMAND_TYPE; data: RequestJoinCommandData }
  | { type: typeof APPROVE_JOIN_COMMAND_TYPE; data: ApproveJoinCommandData }
  | { type: typeof REJECT_JOIN_COMMAND_TYPE; data: RejectJoinCommandData }
  | { type: typeof WITHDRAW_JOIN_COMMAND_TYPE; data: WithdrawJoinCommandData }
  | { type: typeof EXPIRE_JOIN_COMMAND_TYPE; data: ExpireJoinCommandData };
