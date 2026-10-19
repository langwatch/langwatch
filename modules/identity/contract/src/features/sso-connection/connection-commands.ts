import { ledgerActorSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  ssoArrivalPolicySchema,
  ssoConnectionSourceSchema,
  ssoConnectionTypeSchema,
  ssoDomainClaimAuthoritySchema,
  ssoIdpDialingSchema,
  ssoIdpMetadataSchema,
  ssoMigrationRouteSchema,
  ssoAttestationEvidenceRefSchema,
  ssoAttestationNoteSchema,
  ssoPublishedProofChannelSchema,
  ssoVerificationCeremonyMethodSchema,
} from "./connection.ts";

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
/** A domain taken back out of the connection by whoever manages it. */
export const WITHDRAW_DOMAIN_COMMAND_TYPE = "lw.identity.withdraw_domain" as const;
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
/** The word on the card, changed. Nothing routes on it (ADR-117). */
export const RENAME_CONNECTION_COMMAND_TYPE = "lw.identity.rename_connection" as const;
/**
 * Replacing what the engine dials on an existing connection. Its own verb, not a
 * discard and a fresh registration, because the connection id keys the redirect
 * address at the identity provider, and with it domains, proofs and accounts.
 */
export const UPDATE_CONNECTION_IDP_COMMAND_TYPE = "lw.identity.update_connection_idp" as const;
/** The legacy-to-direct cutover, in four verbs: register the one replacement
 *  an organization may run beside its grandfathered connection, choose which
 *  of the pair decides sign-ins, open the durable finalization gate, and
 *  close it once the legacy identities are retired. */
export const REGISTER_REPLACEMENT_CONNECTION_COMMAND_TYPE =
  "lw.identity.register_replacement_connection" as const;
export const SELECT_MIGRATION_ROUTE_COMMAND_TYPE = "lw.identity.select_migration_route" as const;
export const BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE =
  "lw.identity.begin_migration_finalization" as const;
export const FINALIZE_MIGRATION_COMMAND_TYPE = "lw.identity.finalize_migration" as const;

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
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  COMPLETE_TEARDOWN_COMMAND_TYPE,
  GRANDFATHER_CONNECTION_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
  RENAME_CONNECTION_COMMAND_TYPE,
  UPDATE_CONNECTION_IDP_COMMAND_TYPE,
  REGISTER_REPLACEMENT_CONNECTION_COMMAND_TYPE,
  SELECT_MIGRATION_ROUTE_COMMAND_TYPE,
  BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE,
  FINALIZE_MIGRATION_COMMAND_TYPE,
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
  actor: ledgerActorSchema,
  /** Stamped onto every fact the command states. Defaults to self-serve;
   *  only the grandfather migration passes the other value. */
  source: ssoConnectionSourceSchema.default("self-serve"),
});

/**
 * Every connection command enforces `tenantId === organizationId`. Wiring
 * them differently would fold events into another organization's
 * projection undetectably downstream — refused at the wire boundary.
 */
function sameTenantAsOrganization(data: object): boolean {
  return "tenantId" in data && "organizationId" in data && data.tenantId === data.organizationId;
}

function commandDataSchema<Schema extends z.ZodObject>(schema: Schema) {
  return schema.refine(sameTenantAsOrganization, {
    message: "tenantId must equal organizationId: one connection history per organization",
    path: ["tenantId"],
  });
}

const registerConnectionCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    type: ssoConnectionTypeSchema,
    idp: ssoIdpMetadataSchema,
    arrivalPolicy: ssoArrivalPolicySchema,
  }),
);
export interface RegisterConnectionCommandDataSchema extends Named<
  typeof registerConnectionCommandDataSchemaDefinition
> {}
export const registerConnectionCommandDataSchema: RegisterConnectionCommandDataSchema =
  registerConnectionCommandDataSchemaDefinition;
export type RegisterConnectionCommandData = z.infer<typeof registerConnectionCommandDataSchema>;

const registerReplacementConnectionCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    type: ssoConnectionTypeSchema,
    idp: ssoIdpMetadataSchema,
    arrivalPolicy: ssoArrivalPolicySchema,
    replacesConnectionId: z.string().min(1),
  }),
);
export interface RegisterReplacementConnectionCommandDataSchema extends Named<
  typeof registerReplacementConnectionCommandDataSchemaDefinition
> {}
export const registerReplacementConnectionCommandDataSchema: RegisterReplacementConnectionCommandDataSchema =
  registerReplacementConnectionCommandDataSchemaDefinition;
export type RegisterReplacementConnectionCommandData = z.infer<
  typeof registerReplacementConnectionCommandDataSchema
>;

const selectMigrationRouteCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    route: ssoMigrationRouteSchema,
  }),
);
export interface SelectMigrationRouteCommandDataSchema extends Named<
  typeof selectMigrationRouteCommandDataSchemaDefinition
> {}
export const selectMigrationRouteCommandDataSchema: SelectMigrationRouteCommandDataSchema =
  selectMigrationRouteCommandDataSchemaDefinition;
export type SelectMigrationRouteCommandData = z.infer<typeof selectMigrationRouteCommandDataSchema>;

const beginMigrationFinalizationCommandDataSchemaDefinition = commandDataSchema(
  z.object(commandIdentitySchema.shape),
);
export interface BeginMigrationFinalizationCommandDataSchema extends Named<
  typeof beginMigrationFinalizationCommandDataSchemaDefinition
> {}
export const beginMigrationFinalizationCommandDataSchema: BeginMigrationFinalizationCommandDataSchema =
  beginMigrationFinalizationCommandDataSchemaDefinition;
export type BeginMigrationFinalizationCommandData = z.infer<
  typeof beginMigrationFinalizationCommandDataSchema
>;

const finalizeMigrationCommandDataSchemaDefinition = commandDataSchema(
  z.object(commandIdentitySchema.shape),
);
export interface FinalizeMigrationCommandDataSchema extends Named<
  typeof finalizeMigrationCommandDataSchemaDefinition
> {}
export const finalizeMigrationCommandDataSchema: FinalizeMigrationCommandDataSchema =
  finalizeMigrationCommandDataSchemaDefinition;
export type FinalizeMigrationCommandData = z.infer<typeof finalizeMigrationCommandDataSchema>;

/** The word on the card, and nothing else (ADR-117). Trimmed, non-empty, and
 *  bounded so a name stays a name rather than a paragraph. */
const renameConnectionCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    name: z.string().trim().min(1).max(120),
  }),
);
export interface RenameConnectionCommandDataSchema extends Named<
  typeof renameConnectionCommandDataSchemaDefinition
> {}
export const renameConnectionCommandDataSchema: RenameConnectionCommandDataSchema =
  renameConnectionCommandDataSchemaDefinition;
export type RenameConnectionCommandData = z.infer<typeof renameConnectionCommandDataSchema>;

/** The identity provider's dialing information, as references already in the
 *  credential store. The name is not part of it. */
const updateConnectionIdpCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    idp: ssoIdpDialingSchema,
  }),
);
export interface UpdateConnectionIdpCommandDataSchema extends Named<
  typeof updateConnectionIdpCommandDataSchemaDefinition
> {}
export const updateConnectionIdpCommandDataSchema: UpdateConnectionIdpCommandDataSchema =
  updateConnectionIdpCommandDataSchemaDefinition;
export type UpdateConnectionIdpCommandData = z.infer<typeof updateConnectionIdpCommandDataSchema>;

/** The raw domain as it was typed; the guard normalizes it, and only the
 *  normalized form ever reaches a fact. */
const domainShape = { domain: z.string().min(1) };

const claimDomainCommandDataSchemaDefinition = commandDataSchema(
  z.object({ ...commandIdentitySchema.shape, ...domainShape }),
);
export interface ClaimDomainCommandDataSchema extends Named<
  typeof claimDomainCommandDataSchemaDefinition
> {}
export const claimDomainCommandDataSchema: ClaimDomainCommandDataSchema =
  claimDomainCommandDataSchemaDefinition;
export type ClaimDomainCommandData = z.infer<typeof claimDomainCommandDataSchema>;

const approveDomainClaimCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    ...domainShape,
    /** What authorizes the approval. Absent means an operator's hand: a caller
     *  written before the record could decide a claim cannot accidentally
     *  claim an authority it never had. */
    authority: ssoDomainClaimAuthoritySchema.optional(),
  }),
);
export interface ApproveDomainClaimCommandDataSchema extends Named<
  typeof approveDomainClaimCommandDataSchemaDefinition
> {}
export const approveDomainClaimCommandDataSchema: ApproveDomainClaimCommandDataSchema =
  approveDomainClaimCommandDataSchemaDefinition;
export type ApproveDomainClaimCommandData = z.infer<typeof approveDomainClaimCommandDataSchema>;

const rejectDomainClaimCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    ...domainShape,
    note: z.string().min(1),
  }),
);
export interface RejectDomainClaimCommandDataSchema extends Named<
  typeof rejectDomainClaimCommandDataSchemaDefinition
> {}
export const rejectDomainClaimCommandDataSchema: RejectDomainClaimCommandDataSchema =
  rejectDomainClaimCommandDataSchemaDefinition;
export type RejectDomainClaimCommandData = z.infer<typeof rejectDomainClaimCommandDataSchema>;

const discardConnectionCommandDataSchemaDefinition = commandDataSchema(
  z.object(commandIdentitySchema.shape),
);
export interface DiscardConnectionCommandDataSchema extends Named<
  typeof discardConnectionCommandDataSchemaDefinition
> {}
export const discardConnectionCommandDataSchema: DiscardConnectionCommandDataSchema =
  discardConnectionCommandDataSchemaDefinition;
export type DiscardConnectionCommandData = z.infer<typeof discardConnectionCommandDataSchema>;

const requestVerificationCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    ...domainShape,
    method: ssoVerificationCeremonyMethodSchema,
    /** `sha256:…`. The caller hashes the token it showed the operator; this
     *  boundary never sees the token, so it cannot leak one. */
    tokenHash: z.string().min(1),
    /** When the record stops proving anything; absent for a ceremony that does
     *  not expire. */
    expiresAtMs: z.number().int().nonnegative().nullable().optional(),
  }),
);
export interface RequestVerificationCommandDataSchema extends Named<
  typeof requestVerificationCommandDataSchemaDefinition
> {}
export const requestVerificationCommandDataSchema: RequestVerificationCommandDataSchema =
  requestVerificationCommandDataSchemaDefinition;
export type RequestVerificationCommandData = z.infer<typeof requestVerificationCommandDataSchema>;

/**
 * Domain attestation command (D05 tier 1): carries domain only; authorization checked via port.
 */
const attestDomainCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    ...domainShape,
    evidenceRef: ssoAttestationEvidenceRefSchema,
    note: ssoAttestationNoteSchema,
  }),
);
export interface AttestDomainCommandDataSchema extends Named<
  typeof attestDomainCommandDataSchemaDefinition
> {}
export const attestDomainCommandDataSchema: AttestDomainCommandDataSchema =
  attestDomainCommandDataSchemaDefinition;
export type AttestDomainCommandData = z.infer<typeof attestDomainCommandDataSchema>;

const withdrawDomainCommandDataSchemaDefinition = commandDataSchema(
  z.object({ ...commandIdentitySchema.shape, ...domainShape }),
);
export interface WithdrawDomainCommandDataSchema extends Named<
  typeof withdrawDomainCommandDataSchemaDefinition
> {}
export const withdrawDomainCommandDataSchema: WithdrawDomainCommandDataSchema =
  withdrawDomainCommandDataSchemaDefinition;
export type WithdrawDomainCommandData = z.infer<typeof withdrawDomainCommandDataSchema>;

const verifyDomainCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    ...domainShape,
    /** Which channel the caller read the token from. One minted token is
     *  satisfiable as a record or as the well-known file, and what proved it is
     *  what the verified fact records. */
    channel: ssoPublishedProofChannelSchema.optional(),
  }),
);
export interface VerifyDomainCommandDataSchema extends Named<
  typeof verifyDomainCommandDataSchemaDefinition
> {}
export const verifyDomainCommandDataSchema: VerifyDomainCommandDataSchema =
  verifyDomainCommandDataSchemaDefinition;
export type VerifyDomainCommandData = z.infer<typeof verifyDomainCommandDataSchema>;

const recordDomainProofPresentCommandDataSchemaDefinition = commandDataSchema(
  z.object({ ...commandIdentitySchema.shape, ...domainShape }),
);
export interface RecordDomainProofPresentCommandDataSchema extends Named<
  typeof recordDomainProofPresentCommandDataSchemaDefinition
> {}
export const recordDomainProofPresentCommandDataSchema: RecordDomainProofPresentCommandDataSchema =
  recordDomainProofPresentCommandDataSchemaDefinition;
export type RecordDomainProofPresentCommandData = z.infer<
  typeof recordDomainProofPresentCommandDataSchema
>;

/** `graceMs` is passed in rather than read here, so the window a customer is
 *  told about is one composed constant and not a second copy of it. */
const recordDomainProofAbsentCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    ...domainShape,
    graceMs: z.number().int().positive(),
  }),
);
export interface RecordDomainProofAbsentCommandDataSchema extends Named<
  typeof recordDomainProofAbsentCommandDataSchemaDefinition
> {}
export const recordDomainProofAbsentCommandDataSchema: RecordDomainProofAbsentCommandDataSchema =
  recordDomainProofAbsentCommandDataSchemaDefinition;
export type RecordDomainProofAbsentCommandData = z.infer<
  typeof recordDomainProofAbsentCommandDataSchema
>;

const activateConnectionCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    /** The account whose test login the activation rests on; null only for a
     *  grandfathered connection (its production history is the test login). */
    testLoginAccountId: z.string().min(1).nullable(),
  }),
);
export interface ActivateConnectionCommandDataSchema extends Named<
  typeof activateConnectionCommandDataSchemaDefinition
> {}
export const activateConnectionCommandDataSchema: ActivateConnectionCommandDataSchema =
  activateConnectionCommandDataSchemaDefinition;
export type ActivateConnectionCommandData = z.infer<typeof activateConnectionCommandDataSchema>;

const suspendConnectionCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    reason: z.string().min(1).nullable(),
  }),
);
export interface SuspendConnectionCommandDataSchema extends Named<
  typeof suspendConnectionCommandDataSchemaDefinition
> {}
export const suspendConnectionCommandDataSchema: SuspendConnectionCommandDataSchema =
  suspendConnectionCommandDataSchemaDefinition;
export type SuspendConnectionCommandData = z.infer<typeof suspendConnectionCommandDataSchema>;

const resumeConnectionCommandDataSchemaDefinition = commandDataSchema(
  z.object(commandIdentitySchema.shape),
);
export interface ResumeConnectionCommandDataSchema extends Named<
  typeof resumeConnectionCommandDataSchemaDefinition
> {}
export const resumeConnectionCommandDataSchema: ResumeConnectionCommandDataSchema =
  resumeConnectionCommandDataSchemaDefinition;
export type ResumeConnectionCommandData = z.infer<typeof resumeConnectionCommandDataSchema>;

const requestTeardownCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    reason: z.string().min(1).nullable(),
    /** How long the connection stays reversible before the process manager's
     *  wake completes it. Supplied by the caller so the grace is one
     *  composed constant rather than a value this package invents. */
    graceMs: z.number().int().nonnegative(),
  }),
);
export interface RequestTeardownCommandDataSchema extends Named<
  typeof requestTeardownCommandDataSchemaDefinition
> {}
export const requestTeardownCommandDataSchema: RequestTeardownCommandDataSchema =
  requestTeardownCommandDataSchemaDefinition;
export type RequestTeardownCommandData = z.infer<typeof requestTeardownCommandDataSchema>;

const completeTeardownCommandDataSchemaDefinition = commandDataSchema(
  z.object(commandIdentitySchema.shape),
);
export interface CompleteTeardownCommandDataSchema extends Named<
  typeof completeTeardownCommandDataSchemaDefinition
> {}
export const completeTeardownCommandDataSchema: CompleteTeardownCommandDataSchema =
  completeTeardownCommandDataSchemaDefinition;
export type CompleteTeardownCommandData = z.infer<typeof completeTeardownCommandDataSchema>;

/**
 * Grandfather migration command: encodes all history as one with fixed source and idempotent keys.
 */
const grandfatherConnectionCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    type: ssoConnectionTypeSchema,
    idp: ssoIdpMetadataSchema,
    arrivalPolicy: ssoArrivalPolicySchema,
    /** The domains `Organization.ssoDomain` carries, already normalized. */
    domains: z.array(z.string().min(1)).min(1),
    source: z.literal("legacy-grandfathered"),
  }),
);
export interface GrandfatherConnectionCommandDataSchema extends Named<
  typeof grandfatherConnectionCommandDataSchemaDefinition
> {}
export const grandfatherConnectionCommandDataSchema: GrandfatherConnectionCommandDataSchema =
  grandfatherConnectionCommandDataSchemaDefinition;
export type GrandfatherConnectionCommandData = z.infer<
  typeof grandfatherConnectionCommandDataSchema
>;

const setArrivalPolicyCommandDataSchemaDefinition = commandDataSchema(
  z.object({
    ...commandIdentitySchema.shape,
    policy: ssoArrivalPolicySchema,
  }),
);
export interface SetArrivalPolicyCommandDataSchema extends Named<
  typeof setArrivalPolicyCommandDataSchemaDefinition
> {}
export const setArrivalPolicyCommandDataSchema: SetArrivalPolicyCommandDataSchema =
  setArrivalPolicyCommandDataSchemaDefinition;
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
  | { type: typeof WITHDRAW_DOMAIN_COMMAND_TYPE; data: WithdrawDomainCommandData }
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
    }
  | {
      type: typeof RENAME_CONNECTION_COMMAND_TYPE;
      data: RenameConnectionCommandData;
    }
  | {
      type: typeof UPDATE_CONNECTION_IDP_COMMAND_TYPE;
      data: UpdateConnectionIdpCommandData;
    }
  | {
      type: typeof REGISTER_REPLACEMENT_CONNECTION_COMMAND_TYPE;
      data: RegisterReplacementConnectionCommandData;
    }
  | {
      type: typeof SELECT_MIGRATION_ROUTE_COMMAND_TYPE;
      data: SelectMigrationRouteCommandData;
    }
  | {
      type: typeof BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE;
      data: BeginMigrationFinalizationCommandData;
    }
  | {
      type: typeof FINALIZE_MIGRATION_COMMAND_TYPE;
      data: FinalizeMigrationCommandData;
    };
