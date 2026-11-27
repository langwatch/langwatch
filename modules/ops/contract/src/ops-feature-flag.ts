/**
 * The input and output shapes the operator feature-flag surface parses.
 * The rules payload composes `featureFlagRulesWriteSchema` write-time only
 * - the read path must keep accepting whatever is already stored.
 */
import { featureFlagRulesWriteSchema } from "@langwatch/feature-flag-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The acknowledgement each operator feature-flag write returns. */
const opsOkOutputSchemaDefinition = z.object({ ok: z.literal(true) }).strict();
export interface OpsOkOutputSchema extends Named<typeof opsOkOutputSchemaDefinition> {}
export const opsOkOutputSchema: OpsOkOutputSchema = opsOkOutputSchemaDefinition;

const opsFeatureFlagKeyInputSchemaDefinition = z.object({ key: z.string().min(1).max(200) });
export interface OpsFeatureFlagKeyInputSchema extends Named<
  typeof opsFeatureFlagKeyInputSchemaDefinition
> {}
export const opsFeatureFlagKeyInputSchema: OpsFeatureFlagKeyInputSchema =
  opsFeatureFlagKeyInputSchemaDefinition;

const opsSetFeatureFlagInputSchemaDefinition = z.object({
  key: z.string().min(1).max(200),
  enabled: z.boolean(),
});
export interface OpsSetFeatureFlagInputSchema extends Named<
  typeof opsSetFeatureFlagInputSchemaDefinition
> {}
export const opsSetFeatureFlagInputSchema: OpsSetFeatureFlagInputSchema =
  opsSetFeatureFlagInputSchemaDefinition;

/**
 * A rules write. The refinements catch a rule that cannot match anything and
 * therefore silently does nothing: a blank or padded id, and a
 * new-organizations date that cannot be read.
 */
const opsSetFeatureFlagRulesInputSchemaDefinition = z.object({
  ...opsFeatureFlagKeyInputSchema.shape,
  rules: featureFlagRulesWriteSchema,
});
export interface OpsSetFeatureFlagRulesInputSchema extends Named<
  typeof opsSetFeatureFlagRulesInputSchemaDefinition
> {}
export const opsSetFeatureFlagRulesInputSchema: OpsSetFeatureFlagRulesInputSchema =
  opsSetFeatureFlagRulesInputSchemaDefinition;
export type OpsSetFeatureFlagRulesInput = z.infer<typeof opsSetFeatureFlagRulesInputSchema>;

/** The most results one target search answers, so a broad query stays one short list. */
export const FEATURE_FLAG_TARGET_SEARCH_LIMIT = 10;

/** The most ids one target lookup resolves: a flag holds at most 50 rules, each a few ids. */
export const FEATURE_FLAG_TARGET_LOOKUP_LIMIT = 500;

const opsTargetOrganizationRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

/**
 * One organization as the rules dialog tells it apart from others of the same name. `planName`
 * is null when the plan could not be read; `createdAtMs` is epoch milliseconds.
 */
const opsFeatureFlagOrganizationTargetSchemaDefinition = z.object({
  kind: z.literal("organization"),
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAtMs: z.number().int(),
  memberCount: z.number().int(),
  planName: z.string().nullable(),
  administratorEmails: z.array(z.string()),
});
export interface OpsFeatureFlagOrganizationTargetSchema extends Named<
  typeof opsFeatureFlagOrganizationTargetSchemaDefinition
> {}
export const opsFeatureFlagOrganizationTargetSchema: OpsFeatureFlagOrganizationTargetSchema =
  opsFeatureFlagOrganizationTargetSchemaDefinition;

/** One project with the organization it belongs to; null when that organization is gone. */
const opsFeatureFlagProjectTargetSchemaDefinition = z.object({
  kind: z.literal("project"),
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  organization: opsTargetOrganizationRefSchema.nullable(),
});
export interface OpsFeatureFlagProjectTargetSchema extends Named<
  typeof opsFeatureFlagProjectTargetSchemaDefinition
> {}
export const opsFeatureFlagProjectTargetSchema: OpsFeatureFlagProjectTargetSchema =
  opsFeatureFlagProjectTargetSchemaDefinition;

/** One user with the organizations they belong to. */
const opsFeatureFlagUserTargetSchemaDefinition = z.object({
  kind: z.literal("user"),
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  organizations: z.array(opsTargetOrganizationRefSchema),
});
export interface OpsFeatureFlagUserTargetSchema extends Named<
  typeof opsFeatureFlagUserTargetSchemaDefinition
> {}
export const opsFeatureFlagUserTargetSchema: OpsFeatureFlagUserTargetSchema =
  opsFeatureFlagUserTargetSchemaDefinition;

const opsFeatureFlagTargetSchemaDefinition = z.discriminatedUnion("kind", [
  opsFeatureFlagOrganizationTargetSchema,
  opsFeatureFlagProjectTargetSchema,
  opsFeatureFlagUserTargetSchema,
]);
export interface OpsFeatureFlagTargetSchema extends Named<
  typeof opsFeatureFlagTargetSchemaDefinition
> {}
export const opsFeatureFlagTargetSchema: OpsFeatureFlagTargetSchema =
  opsFeatureFlagTargetSchemaDefinition;
export type OpsFeatureFlagTarget = z.infer<typeof opsFeatureFlagTargetSchema>;
export type OpsFeatureFlagTargetKind = OpsFeatureFlagTarget["kind"];

const opsFeatureFlagTargetListSchemaDefinition = z.array(opsFeatureFlagTargetSchema);
export interface OpsFeatureFlagTargetListSchema extends Named<
  typeof opsFeatureFlagTargetListSchemaDefinition
> {}
export const opsFeatureFlagTargetListSchema: OpsFeatureFlagTargetListSchema =
  opsFeatureFlagTargetListSchemaDefinition;

/** A search over one kind of target, by name, slug, id or (for a user) email. */
const opsSearchFeatureFlagTargetsInputSchemaDefinition = z.object({
  kind: z.enum(["organization", "project", "user"]),
  query: z.string().trim().min(1).max(200),
});
export interface OpsSearchFeatureFlagTargetsInputSchema extends Named<
  typeof opsSearchFeatureFlagTargetsInputSchemaDefinition
> {}
export const opsSearchFeatureFlagTargetsInputSchema: OpsSearchFeatureFlagTargetsInputSchema =
  opsSearchFeatureFlagTargetsInputSchemaDefinition;
export type OpsSearchFeatureFlagTargetsInput = z.infer<
  typeof opsSearchFeatureFlagTargetsInputSchema
>;

const targetIdListSchema = z
  .array(z.string().min(1).max(200))
  .max(FEATURE_FLAG_TARGET_LOOKUP_LIMIT);

/** The ids stored rules name, resolved to the same details a search shows. */
const opsFindFeatureFlagTargetsInputSchemaDefinition = z.object({
  organizationIds: targetIdListSchema,
  projectIds: targetIdListSchema,
  userIds: targetIdListSchema,
});
export interface OpsFindFeatureFlagTargetsInputSchema extends Named<
  typeof opsFindFeatureFlagTargetsInputSchemaDefinition
> {}
export const opsFindFeatureFlagTargetsInputSchema: OpsFindFeatureFlagTargetsInputSchema =
  opsFindFeatureFlagTargetsInputSchemaDefinition;
export type OpsFindFeatureFlagTargetsInput = z.infer<typeof opsFindFeatureFlagTargetsInputSchema>;
