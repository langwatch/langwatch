import { z } from "zod";
import {
  ssoArrivalPolicySchema,
  ssoConnectionSourceSchema,
  ssoConnectionTypeSchema,
  ssoDomainClaimAuthoritySchema,
  ssoIdpMetadataSchema,
  ssoPublishedProofChannelSchema,
  ssoVerificationCeremonyMethodSchema,
} from "./connection";
import { identityActorSchema } from "./vocabulary";

/**
 * The SSO connection commands (ADR-117 §5, D04). Every verb the lifecycle
 * has, and no other way to change a connection: the backoffice, the
 * grandfather migration and D05's self-service all arrive here.
 *
 * Each command carries a caller-minted `commandId` — the caller mints it
 * once, retries reuse it, and each emitted fact's idempotency key is
 * `<commandId>:<index>`, so a retried command dedupes at the event store
 * while a legitimately repeated action never can. The grandfather migration
 * derives its ids from the organization (`grandfather:<orgId>`), which is
 * what makes a second pass cost no event.
 *
 * PII does not ride here at all: a connection is org-level configuration.
 * Secrets do not either — commands carry credential REFERENCES, and the DNS
 * ceremony carries the token's hash, exactly as the facts do.
 */

export const REGISTER_CONNECTION_COMMAND_TYPE =
  "lw.identity.register_connection" as const;
export const CLAIM_DOMAIN_COMMAND_TYPE = "lw.identity.claim_domain" as const;
export const APPROVE_DOMAIN_CLAIM_COMMAND_TYPE =
  "lw.identity.approve_domain_claim" as const;
export const REJECT_DOMAIN_CLAIM_COMMAND_TYPE =
  "lw.identity.reject_domain_claim" as const;
export const DISCARD_CONNECTION_COMMAND_TYPE =
  "lw.identity.discard_connection" as const;
export const REQUEST_VERIFICATION_COMMAND_TYPE =
  "lw.identity.request_verification" as const;
export const ATTEST_DOMAIN_COMMAND_TYPE =
  "lw.identity.attest_domain" as const;
export const WITHDRAW_DOMAIN_COMMAND_TYPE =
  "lw.identity.withdraw_domain" as const;
export const VERIFY_DOMAIN_COMMAND_TYPE = "lw.identity.verify_domain" as const;
/**
 * What a re-check saw (ADR-123). Two verbs and no third, because a DNS
 * lookup has three outcomes and only two of them are facts about the
 * customer's domain: the record is there, or it is not. A lookup that FAILED
 * has no verb at all — the scheduler simply does not command, which is what
 * makes "an outage of ours never spends a customer's grace" true by
 * construction rather than by a branch somebody could delete.
 */
export const RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE =
  "lw.identity.record_domain_proof_absent" as const;
export const RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE =
  "lw.identity.record_domain_proof_present" as const;
export const ACTIVATE_CONNECTION_COMMAND_TYPE =
  "lw.identity.activate_connection" as const;
export const SUSPEND_CONNECTION_COMMAND_TYPE =
  "lw.identity.suspend_connection" as const;
export const RESUME_CONNECTION_COMMAND_TYPE =
  "lw.identity.resume_connection" as const;
export const REQUEST_TEARDOWN_COMMAND_TYPE =
  "lw.identity.request_teardown" as const;
export const COMPLETE_TEARDOWN_COMMAND_TYPE =
  "lw.identity.complete_teardown" as const;
/**
 * Who this connection admits, said out loud (ADR-117 §3).
 *
 * A verb of its own rather than a field on `register`, because it is asked
 * after a domain is proved — the answer "anybody on a domain you proved"
 * means nothing until there is one — and because it is a decision an
 * organization revisits without re-registering anything.
 */
export const SET_ARRIVAL_POLICY_COMMAND_TYPE =
  "lw.identity.set_arrival_policy" as const;
/**
 * The one command that STATES HISTORY rather than commanding a change: the
 * grandfather migration's, which records what an organization's `ssoDomain`
 * and `ssoProvider` strings have been doing all along as the history a
 * connection would have had. It creates a connection or it does nothing;
 * it can never move one that already exists, so it cannot be a way around a
 * guard (ADR-117 §5: "grandfathering never weakens a guard").
 */
export const GRANDFATHER_CONNECTION_COMMAND_TYPE =
  "lw.identity.grandfather_connection" as const;

export const SSO_CONNECTION_COMMAND_TYPES = [
  REGISTER_CONNECTION_COMMAND_TYPE,
  CLAIM_DOMAIN_COMMAND_TYPE,
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  DISCARD_CONNECTION_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  ATTEST_DOMAIN_COMMAND_TYPE,
  WITHDRAW_DOMAIN_COMMAND_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  COMPLETE_TEARDOWN_COMMAND_TYPE,
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
  GRANDFATHER_CONNECTION_COMMAND_TYPE,
] as const;
export type SsoConnectionCommandType =
  (typeof SSO_CONNECTION_COMMAND_TYPES)[number];

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
 * Every connection command carries the identity block AND the invariant that
 * makes it one history per organization: `tenantId === organizationId`. A
 * caller wiring them differently would persist events under one tenant's
 * stream and fold them into another organization's projection, which nothing
 * downstream can detect. Refused at the wire boundary instead.
 */
function commandDataSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return commandIdentitySchema
    .extend(shape)
    .refine((data) => data.tenantId === data.organizationId, {
      message:
        "tenantId must equal organizationId: one connection history per organization",
      path: ["tenantId"],
    });
}

export const registerConnectionCommandDataSchema = commandDataSchema({
  type: ssoConnectionTypeSchema,
  idp: ssoIdpMetadataSchema,
  allowsJit: z.boolean(),
});
export type RegisterConnectionCommandData = z.infer<
  typeof registerConnectionCommandDataSchema
>;

/** The raw domain as it was typed; the guard normalizes it, and only the
 *  normalized form ever reaches a fact. */
const domainShape = { domain: z.string().min(1) };

export const claimDomainCommandDataSchema = commandDataSchema(domainShape);
export type ClaimDomainCommandData = z.infer<
  typeof claimDomainCommandDataSchema
>;

/**
 * Approving a claim, and what authorized it (D05 tier 2).
 *
 * `authority` is not the caller asserting its own authorization — it names
 * WHICH check the guard must run, and the guard runs it against a port
 * either way. `platform-operator` asks the platform-operator port about the
 * actor; `license` asks the licence port about the INSTALLATION, which is
 * the only thing a licence can speak for. A hosted deployment's licence port
 * answers no to every organization, so naming the licence there buys nothing.
 */
export const approveDomainClaimCommandDataSchema = commandDataSchema({
  ...domainShape,
  authority: ssoDomainClaimAuthoritySchema.optional(),
});
export type ApproveDomainClaimCommandData = z.infer<
  typeof approveDomainClaimCommandDataSchema
>;

export const rejectDomainClaimCommandDataSchema = commandDataSchema({
  ...domainShape,
  note: z.string().min(1),
});
export type RejectDomainClaimCommandData = z.infer<
  typeof rejectDomainClaimCommandDataSchema
>;

export const discardConnectionCommandDataSchema = commandDataSchema({});
export type DiscardConnectionCommandData = z.infer<
  typeof discardConnectionCommandDataSchema
>;

export const requestVerificationCommandDataSchema = commandDataSchema({
  ...domainShape,
  method: ssoVerificationCeremonyMethodSchema,
  /** `sha256:…`. The caller hashes the token it showed the operator; this
   *  boundary never sees the token, so it cannot leak one. */
  tokenHash: z.string().min(1),
  /** When the record stops proving anything; null or absent for a ceremony
   *  that does not expire, which is what the licence-bound one is. */
  expiresAtMs: z.number().int().nonnegative().nullable().optional(),
});
export type RequestVerificationCommandData = z.infer<
  typeof requestVerificationCommandDataSchema
>;

/**
 * A platform operator attesting a domain (D05 tier 1). Carries the domain and
 * nothing else: no method, because there is only one way to attest, and no
 * token hash, because nothing was published.
 *
 * Who may command it is not a field here — a boolean on the wire saying "I am
 * an operator" would be the caller asserting its own authorization. The guard
 * asks a platform-operator port about `actor` instead.
 */
export const attestDomainCommandDataSchema = commandDataSchema(domainShape);
export type AttestDomainCommandData = z.infer<
  typeof attestDomainCommandDataSchema
>;

/**
 * Take a domain back out of the connection — claim, approval, verification
 * and pending ceremony with it. The guard refuses it for a VERIFIED domain
 * on a connection that is deciding sign-in: while people route through a
 * domain, the way to stop is removing the connection, which is graced and
 * strand-checked, not tidying the domain out from under them.
 */
export const withdrawDomainCommandDataSchema = commandDataSchema(domainShape);
export type WithdrawDomainCommandData = z.infer<
  typeof withdrawDomainCommandDataSchema
>;

/**
 * `channel` is which published channel the caller's check actually read the
 * token from — the TXT record, or the file at the well-known path. Optional,
 * and absent it defaults to the pending ceremony's own method, so every
 * caller that predates the file channel keeps meaning what it always meant.
 * The guard refuses a channel on a ceremony that has none (`license-token`
 * publishes nothing).
 */
export const verifyDomainCommandDataSchema = commandDataSchema({
  ...domainShape,
  channel: ssoPublishedProofChannelSchema.optional(),
});
export type VerifyDomainCommandData = z.infer<
  typeof verifyDomainCommandDataSchema
>;

/**
 * A re-check found no matching record on the domain (ADR-123).
 *
 * `graceMs` is supplied by the caller for the reason teardown's is: the
 * window is a composed constant rather than a number this package invents,
 * and the deadline it produces is written onto the fact so the customer keeps
 * the deadline they were told.
 */
export const recordDomainProofAbsentCommandDataSchema = commandDataSchema({
  ...domainShape,
  graceMs: z.number().int().nonnegative(),
});
export type RecordDomainProofAbsentCommandData = z.infer<
  typeof recordDomainProofAbsentCommandDataSchema
>;

/** A re-check found the record published. Carries the domain and nothing
 *  else: recovery is unconditional and has no window. */
export const recordDomainProofPresentCommandDataSchema =
  commandDataSchema(domainShape);
export type RecordDomainProofPresentCommandData = z.infer<
  typeof recordDomainProofPresentCommandDataSchema
>;

export const activateConnectionCommandDataSchema = commandDataSchema({
  /** The account whose test login the activation rests on; null only for a
   *  grandfathered connection (its production history is the test login). */
  testLoginAccountId: z.string().min(1).nullable(),
});
export type ActivateConnectionCommandData = z.infer<
  typeof activateConnectionCommandDataSchema
>;

export const suspendConnectionCommandDataSchema = commandDataSchema({
  reason: z.string().min(1).nullable(),
});
export type SuspendConnectionCommandData = z.infer<
  typeof suspendConnectionCommandDataSchema
>;

export const resumeConnectionCommandDataSchema = commandDataSchema({});
export type ResumeConnectionCommandData = z.infer<
  typeof resumeConnectionCommandDataSchema
>;

export const requestTeardownCommandDataSchema = commandDataSchema({
  reason: z.string().min(1).nullable(),
  /** How long the connection stays reversible before the process manager's
   *  wake completes it. Supplied by the caller so the grace is one
   *  composed constant rather than a value this package invents. */
  graceMs: z.number().int().nonnegative(),
});
export type RequestTeardownCommandData = z.infer<
  typeof requestTeardownCommandDataSchema
>;

export const completeTeardownCommandDataSchema = commandDataSchema({});
export type CompleteTeardownCommandData = z.infer<
  typeof completeTeardownCommandDataSchema
>;

/**
 * What the legacy strings imply, as one command. The whole history —
 * registered, claimed, approved, verified, activated — is stated in a single
 * commit so the facts share one `commandId` and their idempotency keys are
 * `grandfather:<orgId>:0…4`: a second pass re-derives the identical keys and
 * the event store dedupes every one of them.
 *
 * `source` is fixed rather than defaulted here: nothing else may state a
 * grandfathered fact, and nothing grandfathered may be stated any other way.
 */
export const setArrivalPolicyCommandDataSchema = commandDataSchema({
  policy: ssoArrivalPolicySchema,
});
export type SetArrivalPolicyCommandData = z.infer<
  typeof setArrivalPolicyCommandDataSchema
>;

export const grandfatherConnectionCommandDataSchema = commandDataSchema({
  type: ssoConnectionTypeSchema,
  idp: ssoIdpMetadataSchema,
  allowsJit: z.boolean(),
  /** The domains `Organization.ssoDomain` carries, already normalized. */
  domains: z.array(z.string().min(1)).min(1),
  source: z.literal("legacy-grandfathered"),
});
export type GrandfatherConnectionCommandData = z.infer<
  typeof grandfatherConnectionCommandDataSchema
>;

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
      type: typeof WITHDRAW_DOMAIN_COMMAND_TYPE;
      data: WithdrawDomainCommandData;
    }
  | {
      type: typeof RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE;
      data: RecordDomainProofAbsentCommandData;
    }
  | {
      type: typeof RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE;
      data: RecordDomainProofPresentCommandData;
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
