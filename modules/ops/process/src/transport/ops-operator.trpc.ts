/**
 * The operator behind an `ops.*` procedure. Who may call one is the door's: each procedure
 * declares `ops:view` or `ops:manage` at the platform tier. This file names the person a
 * handler reads beyond that, and the one probe that answers rather than refuses.
 */
import { defineTrpcFact } from "@langwatch/api/trpc";
import { opsOperatorSchema } from "@langwatch/ops-contract";

/**
 * The signed-in person behind the request, including the impersonator where one is present:
 * the handlers that record or refuse by who is acting (audit names, destructive writes) read it.
 */
export const opsOperatorFact = defineTrpcFact("opsOperator", opsOperatorSchema.nullable());

/**
 * The status probe. Answers `{ kind: "none" }` for a non-operator rather
 * than refusing, so the global menu can poll it every page load without
 * spamming the console (lw#3584); it discloses only whether the caller is staff.
 */
export const OPS_PROBE = {
  reason:
    "the probe reads the caller's OWN operator reach and answers it, so refusing a " +
    "non-operator would be refusing to say no",
} as const;
