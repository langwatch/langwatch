import type { Named } from "@langwatch/module";
import { z } from "zod";

export const SSO_FEATURE_ID = "sso" as const;

/**
 * One connection as the back office reads it. Named fields, not `unknown`: a
 * tRPC procedure publishes what its handler returns, so an `unknown` here is
 * what the browser gets, and the list reads every row field below.
 */
const adminSsoConnectionSchemaDefinition = z
  .object({
    connectionId: z.string(),
    organizationId: z.string(),
    /** Null when the organization no longer exists. */
    organizationName: z.string().nullable(),
    type: z.string(),
    state: z.string(),
    claimedDomains: z.array(z.string()),
    approvedDomains: z.array(z.string()),
    verifiedDomains: z.array(z.string()),
    domainVerifications: z.array(
      z
        .object({
          domain: z.string(),
          method: z.string(),
          actorId: z.string().nullable(),
          verifiedAtMs: z.number(),
        })
        .strict(),
    ),
    providerId: z.string(),
    issuer: z.string().nullable(),
    allowsJit: z.boolean(),
    /** Who the connection admits. `allowsJit` above is the derived boolean
     *  identity keeps beside it for readers written before the policy. */
    arrivalPolicy: z.enum(["admit", "request", "refuse"]),
    source: z.string(),
    testLoginAccountId: z.string().nullable(),
    rejection: z.object({ domain: z.string(), note: z.string() }).strict().nullable(),
    pendingVerificationDomain: z.string().nullable(),
    /** When the ceremony in flight stops proving anything; null when none is
     *  in flight, or when it does not expire. */
    pendingVerificationExpiresAtMs: z.number().nullable(),
    createdAtMs: z.number(),
    updatedAtMs: z.number(),
  })
  .strict();
export interface AdminSsoConnectionSchema extends Named<
  typeof adminSsoConnectionSchemaDefinition
> {}
export const adminSsoConnectionSchema: AdminSsoConnectionSchema =
  adminSsoConnectionSchemaDefinition;

/** One page of connections, with the total the pager reads. */
const adminSsoConnectionPageSchemaDefinition = z
  .object({
    connections: z.array(adminSsoConnectionSchema),
    total: z.number().int().nonnegative(),
  })
  .strict();
export interface AdminSsoConnectionPageSchema extends Named<
  typeof adminSsoConnectionPageSchemaDefinition
> {}
export const adminSsoConnectionPageSchema: AdminSsoConnectionPageSchema =
  adminSsoConnectionPageSchemaDefinition;

export type AdminSsoConnection = z.infer<typeof adminSsoConnectionSchema>;
export type AdminSsoConnectionPage = z.infer<typeof adminSsoConnectionPageSchema>;

/** One page of the back office's list, as the pager asks for it. */
const listSsoConnectionsInputSchemaDefinition = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().max(253).optional(),
});
export interface ListSsoConnectionsInputSchema extends Named<
  typeof listSsoConnectionsInputSchemaDefinition
> {}
export const listSsoConnectionsInputSchema: ListSsoConnectionsInputSchema =
  listSsoConnectionsInputSchemaDefinition;
export type ListSsoConnectionsInput = z.infer<typeof listSsoConnectionsInputSchema>;

const ssoConnectionByIdSchemaDefinition = z.object({ connectionId: z.string().min(1) });
export interface SsoConnectionByIdSchema extends Named<typeof ssoConnectionByIdSchemaDefinition> {}
export const ssoConnectionByIdSchema: SsoConnectionByIdSchema = ssoConnectionByIdSchemaDefinition;
export type SsoConnectionByIdInput = z.infer<typeof ssoConnectionByIdSchema>;

/** One page of a cutover's members, found by connection alone: the operator is cross-tenant. */
const operatorSsoMigrationProgressInputSchemaDefinition = z.object({
  ...ssoConnectionByIdSchema.shape,
  cursor: z.string().nullable().default(null),
  limit: z.number().int().min(1).max(100).default(50),
});
export interface OperatorSsoMigrationProgressInputSchema extends Named<
  typeof operatorSsoMigrationProgressInputSchemaDefinition
> {}
export const operatorSsoMigrationProgressInputSchema: OperatorSsoMigrationProgressInputSchema =
  operatorSsoMigrationProgressInputSchemaDefinition;
export type OperatorSsoMigrationProgressInput = z.infer<
  typeof operatorSsoMigrationProgressInputSchema
>;

/**
 * The organization is routing, not reach: it says whose connection history the
 * command is appended to. Who may issue it is the platform-operator grant, and nothing else.
 */
const ssoConnectionTargetSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  connectionId: z.string().min(1),
});
export interface SsoConnectionTargetSchema extends Named<
  typeof ssoConnectionTargetSchemaDefinition
> {}
export const ssoConnectionTargetSchema: SsoConnectionTargetSchema =
  ssoConnectionTargetSchemaDefinition;
export type SsoConnectionTarget = z.infer<typeof ssoConnectionTargetSchema>;

const ssoDomainTargetSchemaDefinition = z.object({
  ...ssoConnectionTargetSchema.shape,
  domain: z.string().min(1).max(253),
});
export interface SsoDomainTargetSchema extends Named<typeof ssoDomainTargetSchemaDefinition> {}
export const ssoDomainTargetSchema: SsoDomainTargetSchema = ssoDomainTargetSchemaDefinition;
export type SsoDomainTarget = z.infer<typeof ssoDomainTargetSchema>;

const rejectSsoDomainClaimInputSchemaDefinition = z.object({
  ...ssoDomainTargetSchema.shape,
  note: z.string().min(1).max(1000),
});
export interface RejectSsoDomainClaimInputSchema extends Named<
  typeof rejectSsoDomainClaimInputSchemaDefinition
> {}
export const rejectSsoDomainClaimInputSchema: RejectSsoDomainClaimInputSchema =
  rejectSsoDomainClaimInputSchemaDefinition;
export type RejectSsoDomainClaimInput = z.infer<typeof rejectSsoDomainClaimInputSchema>;

/** Vouching for a domain names the evidence and why it proves control. */
const attestSsoDomainInputSchemaDefinition = z.object({
  ...ssoDomainTargetSchema.shape,
  evidenceRef: z.string().trim().min(1).max(500),
  note: z.string().trim().min(1).max(1_000),
});
export interface AttestSsoDomainInputSchema extends Named<
  typeof attestSsoDomainInputSchemaDefinition
> {}
export const attestSsoDomainInputSchema: AttestSsoDomainInputSchema =
  attestSsoDomainInputSchemaDefinition;
export type AttestSsoDomainInput = z.infer<typeof attestSsoDomainInputSchema>;

/**
 * The protocol union the aggregate speaks, so a SAML request reaches the ledger
 * and is refused BY NAME. Narrowing it to `"oidc"` would tell the operator the
 * field is wrong rather than that the protocol is not self-serve yet.
 */
const registerSsoConnectionInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  type: z.enum(["oidc", "saml"]),
  providerId: z.string().min(1).max(100),
  issuer: z.string().max(2048).nullable().default(null),
  allowsJit: z.boolean().default(false),
  /** Stated policy wins over `allowsJit`, which identity reads only when the
   *  caller states none. */
  arrivalPolicy: z.enum(["admit", "request", "refuse"]).optional(),
});
export interface RegisterSsoConnectionInputSchema extends Named<
  typeof registerSsoConnectionInputSchemaDefinition
> {}
export const registerSsoConnectionInputSchema: RegisterSsoConnectionInputSchema =
  registerSsoConnectionInputSchemaDefinition;
export type RegisterSsoConnectionInput = z.infer<typeof registerSsoConnectionInputSchema>;

const activateSsoConnectionInputSchemaDefinition = z.object({
  ...ssoConnectionTargetSchema.shape,
  testLoginAccountId: z.string().min(1),
});
export interface ActivateSsoConnectionInputSchema extends Named<
  typeof activateSsoConnectionInputSchemaDefinition
> {}
export const activateSsoConnectionInputSchema: ActivateSsoConnectionInputSchema =
  activateSsoConnectionInputSchemaDefinition;
export type ActivateSsoConnectionInput = z.infer<typeof activateSsoConnectionInputSchema>;

/** Suspending and requesting a teardown both carry the same optional reason. */
const ssoConnectionReasonInputSchemaDefinition = z.object({
  ...ssoConnectionTargetSchema.shape,
  reason: z.string().min(1).max(1000).nullable().default(null),
});
export interface SsoConnectionReasonInputSchema extends Named<
  typeof ssoConnectionReasonInputSchemaDefinition
> {}
export const ssoConnectionReasonInputSchema: SsoConnectionReasonInputSchema =
  ssoConnectionReasonInputSchemaDefinition;
export type SsoConnectionReasonInput = z.infer<typeof ssoConnectionReasonInputSchema>;
