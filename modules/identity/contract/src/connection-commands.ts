import { z } from "zod";

import {
  ssoArrivalPolicySchema,
  ssoConnectionSourceSchema,
  ssoConnectionTypeSchema,
  ssoDomainClaimAuthoritySchema,
  ssoIdpMetadataSchema,
  ssoPublishedProofChannelSchema,
  ssoVerificationCeremonyMethodSchema,
} from "./connection.ts";
import { identityActorSchema } from "./vocabulary.ts";

/**
 * SSO connection commands (ADR-117 §5, D04): lifecycle verbs with idempotent retries via commandId.
 * Commands carry credential references, not PII or secrets.
 */

export const REGISTER_CONNECTION_COMMAND_TYPE = "lw.identity.register_connection" as const;
export const CLAIM_DOMAIN_COMMAND_TYPE = "lw.identity.claim_domain" as const;
export const APPROVE_DOMAIN_CLAIM_COMMAND_TYPE = "lw.identity.approve_domain_claim" as const;
export const REJECT_DOMAIN_CLAIM_COMMAND_TYPE = "lw.identity.reject_domain_claim" as const;
export const DISCARD_CONNECTION_COMMAND_TYPE = "lw.identity.discard_connection" as const;
export const REQUEST_VERIFICATION_COMMAND_TYPE = "lw.identity.request_verification" as const;
export const ATTEST_DOMAIN_COMMAND_TYPE = "lw.identity.attest_domain" as const;
export const VERIFY_DOMAIN_COMMAND_TYPE = "lw.identity.verify_domain" as const;
export const ACTIVATE_CONNECTION_COMMAND_TYPE = "lw.identity.activate_connection" as const;
export const SUSPEND_CONNECTION_COMMAND_TYPE = "lw.identity.suspend_connection" as const;
export const RESUME_CONNECTION_COMMAND_TYPE = "lw.identity.resume_connection" as const;
export const REQUEST_TEARDOWN_COMMAND_TYPE = "lw.identity.request_teardown" as const;
export const COMPLETE_TEARDOWN_COMMAND_TYPE = "lw.identity.complete_teardown" as const;
/**
 * The one command that STATES HISTORY rather than commands a change: the
 * grandfather migration's. Creates a connection or does nothing — never
 * moves an existing one, so it cannot be a way around a guard (ADR-117 §5).
 */
export const GRANDFATHER_CONNECTION_COMMAND_TYPE = "lw.identity.grandfather_connection" as const;
/**
 * What a re-read of a published proof found (ADR-123). Two commands rather
 * than one carrying a boolean: "the record is there" and "the record is
 * gone" lead to different facts, and only the second one carries a clock.
 */
export const RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE =
  "lw.identity.record_domain_proof_present" as const;
export const RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE =
  "lw.identity.record_domain_proof_absent" as const;
/** Somebody decided who this connection admits (ADR-117 §3). */
export const SET_ARRIVAL_POLICY_COMMAND_TYPE = "lw.identity.set_arrival_policy" as const;

export const SSO_CONNECTION_COMMAND_TYPES = [
  REGISTER_CONNECTION_COMMAND_TYPE,
  CLAIM_DOMAIN_COMMAND_TYPE,
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  DISCARD_CONNECTION_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  ATTEST_DOMAIN_COMMAND_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  COMPLETE_TEARDOWN_COMMAND_TYPE,
  GRANDFATHER_CONNECTION_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
] as const;
export type SsoConnectionCommandType = (typeof SSO_CONNECTION_COMMAND_TYPES)[number];

const commandIdentitySchema = z.object({
  /** The ORGANIZATION is the tenant of its connections' history; the
   *  framework builds the command envelope's tenantId from this field. */
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  /** The aggregate. One connection, one history, one lane. */
  connectionId: z.string().min(1),
  commandId: z.string().min(1),
  occurredAtMs: z.number().int().nonnegative(),
  actor: identityActorSchema,
  /** Stamped onto every fact the command states. Defaults to self-serve;
   *  only the grandfather migration passes the other value. */
  source: ssoConnectionSourceSchema.default("self-serve"),
});

/**
 * Every connection command enforces `tenantId === organizationId`. Wiring
 * them differently would fold events into another organization's
 * projection undetectably downstream — refused at the wire boundary.
 */
function commandDataSchema<Shape extends z.ZodRawShape>(
  shape: Shape,
): z.ZodType<z.infer<ReturnType<typeof commandIdentitySchema.extend<Shape>>>> {
  return commandIdentitySchema.extend(shape).refine(
    (data) => {
      // zod 4 widens `.extend()`'s output under a generic shape to a union that
      // no longer names the base's own keys, so the fields this reads are named
      // here rather than inferred. They come from `commandIdentitySchema`, never
      // from `shape`, so they are always present whatever a caller extends with.
      const { tenantId, organizationId } = data as z.infer<typeof commandIdentitySchema>;
      return tenantId === organizationId;
    },
    {
      message: "tenantId must equal organizationId: one connection history per organization",
      path: ["tenantId"],
    },
  );
}

export const registerConnectionCommandDataSchema = commandDataSchema({
  type: ssoConnectionTypeSchema,
  idp: ssoIdpMetadataSchema,
  arrivalPolicy: ssoArrivalPolicySchema,
});
export type RegisterConnectionCommandData = z.infer<typeof registerConnectionCommandDataSchema>;

/** The raw domain as it was typed; the guard normalizes it, and only the
 *  normalized form ever reaches a fact. */
const domainShape = { domain: z.string().min(1) };

export const claimDomainCommandDataSchema = commandDataSchema(domainShape);
export type ClaimDomainCommandData = z.infer<typeof claimDomainCommandDataSchema>;

export const approveDomainClaimCommandDataSchema = commandDataSchema({
  ...domainShape,
  /** What authorizes the approval. Absent means an operator's hand: a caller
   *  written before the record could decide a claim cannot accidentally
   *  claim an authority it never had. */
  authority: ssoDomainClaimAuthoritySchema.optional(),
});
export type ApproveDomainClaimCommandData = z.infer<typeof approveDomainClaimCommandDataSchema>;

export const rejectDomainClaimCommandDataSchema = commandDataSchema({
  ...domainShape,
  note: z.string().min(1),
});
export type RejectDomainClaimCommandData = z.infer<typeof rejectDomainClaimCommandDataSchema>;

export const discardConnectionCommandDataSchema = commandDataSchema({});
export type DiscardConnectionCommandData = z.infer<typeof discardConnectionCommandDataSchema>;

export const requestVerificationCommandDataSchema = commandDataSchema({
  ...domainShape,
  method: ssoVerificationCeremonyMethodSchema,
  /** `sha256:…`. The caller hashes the token it showed the operator; this
   *  boundary never sees the token, so it cannot leak one. */
  tokenHash: z.string().min(1),
  /** When the record stops proving anything; absent for a ceremony that does
   *  not expire. */
  expiresAtMs: z.number().int().nonnegative().nullable().optional(),
});
export type RequestVerificationCommandData = z.infer<typeof requestVerificationCommandDataSchema>;

/**
 * Domain attestation command (D05 tier 1): carries domain only; authorization checked via port.
 */
export const attestDomainCommandDataSchema = commandDataSchema(domainShape);
export type AttestDomainCommandData = z.infer<typeof attestDomainCommandDataSchema>;

export const verifyDomainCommandDataSchema = commandDataSchema({
  ...domainShape,
  /** Which channel the caller read the token from. One minted token is
   *  satisfiable as a record or as the well-known file, and what proved it is
   *  what the verified fact records. */
  channel: ssoPublishedProofChannelSchema.optional(),
});
export type VerifyDomainCommandData = z.infer<typeof verifyDomainCommandDataSchema>;

export const recordDomainProofPresentCommandDataSchema = commandDataSchema(domainShape);
export type RecordDomainProofPresentCommandData = z.infer<
  typeof recordDomainProofPresentCommandDataSchema
>;

/** `graceMs` is passed in rather than read here, so the window a customer is
 *  told about is one composed constant and not a second copy of it. */
export const recordDomainProofAbsentCommandDataSchema = commandDataSchema({
  ...domainShape,
  graceMs: z.number().int().positive(),
});
export type RecordDomainProofAbsentCommandData = z.infer<
  typeof recordDomainProofAbsentCommandDataSchema
>;

export const activateConnectionCommandDataSchema = commandDataSchema({
  /** The account whose test login the activation rests on; null only for a
   *  grandfathered connection (its production history is the test login). */
  testLoginAccountId: z.string().min(1).nullable(),
});
export type ActivateConnectionCommandData = z.infer<typeof activateConnectionCommandDataSchema>;

export const suspendConnectionCommandDataSchema = commandDataSchema({
  reason: z.string().min(1).nullable(),
});
export type SuspendConnectionCommandData = z.infer<typeof suspendConnectionCommandDataSchema>;

export const resumeConnectionCommandDataSchema = commandDataSchema({});
export type ResumeConnectionCommandData = z.infer<typeof resumeConnectionCommandDataSchema>;

export const requestTeardownCommandDataSchema = commandDataSchema({
  reason: z.string().min(1).nullable(),
  /** How long the connection stays reversible before the process manager's
   *  wake completes it. Supplied by the caller so the grace is one
   *  composed constant rather than a value this package invents. */
  graceMs: z.number().int().nonnegative(),
});
export type RequestTeardownCommandData = z.infer<typeof requestTeardownCommandDataSchema>;

export const completeTeardownCommandDataSchema = commandDataSchema({});
export type CompleteTeardownCommandData = z.infer<typeof completeTeardownCommandDataSchema>;

/**
 * Grandfather migration command: encodes all history as one with fixed source and idempotent keys.
 */
export const grandfatherConnectionCommandDataSchema = commandDataSchema({
  type: ssoConnectionTypeSchema,
  idp: ssoIdpMetadataSchema,
  arrivalPolicy: ssoArrivalPolicySchema,
  /** The domains `Organization.ssoDomain` carries, already normalized. */
  domains: z.array(z.string().min(1)).min(1),
  source: z.literal("legacy-grandfathered"),
});
export type GrandfatherConnectionCommandData = z.infer<
  typeof grandfatherConnectionCommandDataSchema
>;

export const setArrivalPolicyCommandDataSchema = commandDataSchema({
  policy: ssoArrivalPolicySchema,
});
export type SetArrivalPolicyCommandData = z.infer<typeof setArrivalPolicyCommandDataSchema>;

/** One connection command, typed on its verb — what the ledger stages. */
export type SsoConnectionCommand =
  | {
      type: typeof REGISTER_CONNECTION_COMMAND_TYPE;
      data: RegisterConnectionCommandData;
    }
  | { type: typeof CLAIM_DOMAIN_COMMAND_TYPE; data: ClaimDomainCommandData }
  | {
      type: typeof APPROVE_DOMAIN_CLAIM_COMMAND_TYPE;
      data: ApproveDomainClaimCommandData;
    }
  | {
      type: typeof REJECT_DOMAIN_CLAIM_COMMAND_TYPE;
      data: RejectDomainClaimCommandData;
    }
  | {
      type: typeof DISCARD_CONNECTION_COMMAND_TYPE;
      data: DiscardConnectionCommandData;
    }
  | {
      type: typeof REQUEST_VERIFICATION_COMMAND_TYPE;
      data: RequestVerificationCommandData;
    }
  | { type: typeof ATTEST_DOMAIN_COMMAND_TYPE; data: AttestDomainCommandData }
  | { type: typeof VERIFY_DOMAIN_COMMAND_TYPE; data: VerifyDomainCommandData }
  | {
      type: typeof RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE;
      data: RecordDomainProofPresentCommandData;
    }
  | {
      type: typeof RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE;
      data: RecordDomainProofAbsentCommandData;
    }
  | {
      type: typeof ACTIVATE_CONNECTION_COMMAND_TYPE;
      data: ActivateConnectionCommandData;
    }
  | {
      type: typeof SUSPEND_CONNECTION_COMMAND_TYPE;
      data: SuspendConnectionCommandData;
    }
  | {
      type: typeof RESUME_CONNECTION_COMMAND_TYPE;
      data: ResumeConnectionCommandData;
    }
  | {
      type: typeof REQUEST_TEARDOWN_COMMAND_TYPE;
      data: RequestTeardownCommandData;
    }
  | {
      type: typeof COMPLETE_TEARDOWN_COMMAND_TYPE;
      data: CompleteTeardownCommandData;
    }
  | {
      type: typeof SET_ARRIVAL_POLICY_COMMAND_TYPE;
      data: SetArrivalPolicyCommandData;
    }
  | {
      type: typeof GRANDFATHER_CONNECTION_COMMAND_TYPE;
      data: GrandfatherConnectionCommandData;
    };
