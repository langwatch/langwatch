import { actorSchema, authzPermissionSchema, ledgerActorSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { authzPrincipalRefSchema } from "./authz.ts";

/** Whose permissions bound a braid is the session's, so a procedure's input never names it. */
const sessionShape = { actor: ledgerActorSchema, caller: authzPrincipalRefSchema };

/** A braid's terms (ADR-183 §1): the condition text, which spans by time, and when access ends. */
const braidTermsShape = {
  /** The OTTL-subset condition as written; absent or blank braids every owner span. */
  where: z.string().optional(),
  /** The earliest span shown, epoch milliseconds; may fall before the day the braid is made. */
  fromMs: z.number().int().nonnegative(),
  /** When the reader stops seeing the spans; absent never ends. */
  expiresAtMs: z.number().int().positive().optional(),
};

const authzCreateBraidInputSchemaDefinition = z
  .object({
    /** The owner, whose spans the reader sees. */
    projectId: z.string().min(1),
    readerProjectId: z.string().min(1),
    ...braidTermsShape,
    ...sessionShape,
  })
  .strict();
export interface AuthzCreateBraidInputSchema extends Named<
  typeof authzCreateBraidInputSchemaDefinition
> {}
export const authzCreateBraidInputSchema: AuthzCreateBraidInputSchema =
  authzCreateBraidInputSchemaDefinition;
export type AuthzCreateBraidInput = z.infer<typeof authzCreateBraidInputSchema>;

const authzChangeBraidInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    readerProjectId: z.string().min(1),
    /** The braid being changed; refused with `braid_changed` once it is no longer live. */
    braidId: z.string().min(1),
    ...braidTermsShape,
    ...sessionShape,
  })
  .strict();
export interface AuthzChangeBraidInputSchema extends Named<
  typeof authzChangeBraidInputSchemaDefinition
> {}
export const authzChangeBraidInputSchema: AuthzChangeBraidInputSchema =
  authzChangeBraidInputSchemaDefinition;
export type AuthzChangeBraidInput = z.infer<typeof authzChangeBraidInputSchema>;

const authzRemoveBraidInputSchemaDefinition = z
  .object({
    /** Either side of the braid: its owner or its reader. */
    projectId: z.string().min(1),
    braidId: z.string().min(1),
    ...sessionShape,
  })
  .strict();
export interface AuthzRemoveBraidInputSchema extends Named<
  typeof authzRemoveBraidInputSchemaDefinition
> {}
export const authzRemoveBraidInputSchema: AuthzRemoveBraidInputSchema =
  authzRemoveBraidInputSchemaDefinition;
export type AuthzRemoveBraidInput = z.infer<typeof authzRemoveBraidInputSchema>;

const authzListBraidsInputSchemaDefinition = z.object({ projectId: z.string().min(1) }).strict();
export interface AuthzListBraidsInputSchema extends Named<
  typeof authzListBraidsInputSchemaDefinition
> {}
export const authzListBraidsInputSchema: AuthzListBraidsInputSchema =
  authzListBraidsInputSchemaDefinition;
export type AuthzListBraidsInput = z.infer<typeof authzListBraidsInputSchema>;

/** ADR-183 §7: which permission to count a project's members holding, for the braid dialog. */
const authzCountProjectMembersHoldingInputSchemaDefinition = z
  .object({ projectId: z.string().min(1), permission: authzPermissionSchema })
  .strict();
export interface AuthzCountProjectMembersHoldingInputSchema extends Named<
  typeof authzCountProjectMembersHoldingInputSchemaDefinition
> {}
export const authzCountProjectMembersHoldingInputSchema: AuthzCountProjectMembersHoldingInputSchema =
  authzCountProjectMembersHoldingInputSchemaDefinition;
export type AuthzCountProjectMembersHoldingInput = z.infer<
  typeof authzCountProjectMembersHoldingInputSchema
>;

/** How many members hold it; `exact` is false past the decided limit, and `count` a floor. */
const authzProjectMembersHoldingSchemaDefinition = z
  .object({ count: z.number().int().nonnegative(), exact: z.boolean() })
  .strict();
export interface AuthzProjectMembersHoldingSchema extends Named<
  typeof authzProjectMembersHoldingSchemaDefinition
> {}
export const authzProjectMembersHoldingSchema: AuthzProjectMembersHoldingSchema =
  authzProjectMembersHoldingSchemaDefinition;
export type AuthzProjectMembersHolding = z.infer<typeof authzProjectMembersHoldingSchema>;

/** Projects a braid dialog's picker asks about at most; the host lists the organisation's. */
export const BRAID_TARGETS_LIMIT = 500;

/** Which of `projectIds` the caller may braid `projectId` into, decided in one batch. */
const authzListBraidTargetsInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    projectIds: z.array(z.string().min(1)).max(BRAID_TARGETS_LIMIT),
    caller: authzPrincipalRefSchema,
  })
  .strict();
export interface AuthzListBraidTargetsInputSchema extends Named<
  typeof authzListBraidTargetsInputSchemaDefinition
> {}
export const authzListBraidTargetsInputSchema: AuthzListBraidTargetsInputSchema =
  authzListBraidTargetsInputSchemaDefinition;
export type AuthzListBraidTargetsInput = z.infer<typeof authzListBraidTargetsInputSchema>;

/** Why a listed project cannot be braided into: the braid's own project, or an aggregate. */
export const braidTargetRefusalSchema = z.enum(["this_project", "aggregate"]);
export type BraidTargetRefusal = z.infer<typeof braidTargetRefusalSchema>;

/** The asked projects whose traces the caller can read, in the order asked; the rest left out. */
const authzBraidTargetsSchemaDefinition = z.array(
  z
    .object({
      projectId: z.string(),
      selectable: z.boolean(),
      reason: braidTargetRefusalSchema.optional(),
    })
    .strict(),
);
export interface AuthzBraidTargetsSchema extends Named<typeof authzBraidTargetsSchemaDefinition> {}
export const authzBraidTargetsSchema: AuthzBraidTargetsSchema = authzBraidTargetsSchemaDefinition;
export type AuthzBraidTargets = z.infer<typeof authzBraidTargetsSchema>;

/** One live braid as both projects' settings show it. */
const authzBraidSchemaDefinition = z
  .object({
    braidId: z.string().min(1),
    ownerProjectId: z.string().min(1),
    readerProjectId: z.string().min(1),
    where: z.string().nullable(),
    fromMs: z.number().int(),
    expiresAtMs: z.number().int().nullable(),
    createdByUserId: z.string().nullable(),
    createdAtMs: z.number().int(),
  })
  .strict();
export interface AuthzBraidSchema extends Named<typeof authzBraidSchemaDefinition> {}
export const authzBraidSchema: AuthzBraidSchema = authzBraidSchemaDefinition;
export type AuthzBraid = z.infer<typeof authzBraidSchema>;

/** A project's braids: out of it into other projects, and into it from other projects. */
const authzProjectBraidsSchemaDefinition = z
  .object({
    intoOtherProjects: z.array(authzBraidSchema),
    fromOtherProjects: z.array(authzBraidSchema),
  })
  .strict();
export interface AuthzProjectBraidsSchema extends Named<
  typeof authzProjectBraidsSchemaDefinition
> {}
export const authzProjectBraidsSchema: AuthzProjectBraidsSchema =
  authzProjectBraidsSchemaDefinition;
export type AuthzProjectBraids = z.infer<typeof authzProjectBraidsSchema>;

const authzBraidRemovedSchemaDefinition = z.object({ braidId: z.string().min(1) }).strict();
export interface AuthzBraidRemovedSchema extends Named<typeof authzBraidRemovedSchemaDefinition> {}
export const authzBraidRemovedSchema: AuthzBraidRemovedSchema = authzBraidRemovedSchemaDefinition;
export type AuthzBraidRemoved = z.infer<typeof authzBraidRemovedSchema>;

/** ADR-183 §8: who read which reader's traces holding spans braided from which owners. */
const authzRecordBraidedSpansViewInputSchemaDefinition = z
  .object({
    actor: actorSchema,
    readerProjectId: z.string().min(1),
    /** The owners whose braided spans the read showed; the reader itself is ignored. */
    ownerProjectIds: z.array(z.string().min(1)),
  })
  .strict();
export interface AuthzRecordBraidedSpansViewInputSchema extends Named<
  typeof authzRecordBraidedSpansViewInputSchemaDefinition
> {}
export const authzRecordBraidedSpansViewInputSchema: AuthzRecordBraidedSpansViewInputSchema =
  authzRecordBraidedSpansViewInputSchemaDefinition;
export type AuthzRecordBraidedSpansViewInput = z.infer<
  typeof authzRecordBraidedSpansViewInputSchema
>;

const organizationShape = { organizationId: z.string().min(1) };

/** ADR-183 §2: an organisation's authz settings; one that never changed them has every one off. */
const authzOrganizationPolicySchemaDefinition = z
  .object({
    ...organizationShape,
    /** While on, only organisation-wide bindings confer `braids:manage`. */
    braidsOrganizationAdminsOnly: z.boolean(),
    updatedByUserId: z.string().nullable(),
    updatedAtMs: z.number().int().nullable(),
  })
  .strict();
export interface AuthzOrganizationPolicySchema extends Named<
  typeof authzOrganizationPolicySchemaDefinition
> {}
export const authzOrganizationPolicySchema: AuthzOrganizationPolicySchema =
  authzOrganizationPolicySchemaDefinition;
export type AuthzOrganizationPolicy = z.infer<typeof authzOrganizationPolicySchema>;

const authzOrganizationInputSchemaDefinition = z.object(organizationShape).strict();
export interface AuthzOrganizationInputSchema extends Named<
  typeof authzOrganizationInputSchemaDefinition
> {}
export const authzOrganizationInputSchema: AuthzOrganizationInputSchema =
  authzOrganizationInputSchemaDefinition;
export type AuthzOrganizationInput = z.infer<typeof authzOrganizationInputSchema>;

const authzSetBraidsPolicyInputSchemaDefinition = z
  .object({
    ...organizationShape,
    braidsOrganizationAdminsOnly: z.boolean(),
    actor: ledgerActorSchema,
  })
  .strict();
export interface AuthzSetBraidsPolicyInputSchema extends Named<
  typeof authzSetBraidsPolicyInputSchemaDefinition
> {}
export const authzSetBraidsPolicyInputSchema: AuthzSetBraidsPolicyInputSchema =
  authzSetBraidsPolicyInputSchemaDefinition;
export type AuthzSetBraidsPolicyInput = z.infer<typeof authzSetBraidsPolicyInputSchema>;

/** Every live braid in an organisation, for its admins' Braids screen. */
const authzOrganizationBraidsSchemaDefinition = z.array(authzBraidSchema);
export interface AuthzOrganizationBraidsSchema extends Named<
  typeof authzOrganizationBraidsSchemaDefinition
> {}
export const authzOrganizationBraidsSchema: AuthzOrganizationBraidsSchema =
  authzOrganizationBraidsSchemaDefinition;
export type AuthzOrganizationBraids = z.infer<typeof authzOrganizationBraidsSchema>;
