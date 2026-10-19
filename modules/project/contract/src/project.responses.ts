/**
 * What the project's transports answer, stated once: the tRPC chain declares
 * each procedure's `withOutput` from here, so the shape a client reads is in
 * the contract rather than implied by whatever a handler happened to return.
 */

// Checked against real answers in development and test; production returns
// the handler's own value.

import { dataPrivacyPiiRedactionLevelSchema } from "@langwatch/data-privacy-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  aggregateMemberCandidateSchema,
  aggregateRuleMembersSchema,
} from "./project.aggregate-rule.ts";

/** A project was provisioned; the slug is what the caller navigates to. */
const projectProvisionedSchemaDefinition = z
  .object({ success: z.literal(true), projectSlug: z.string().min(1) })
  .strict();
export interface ProjectProvisionedSchema extends Named<
  typeof projectProvisionedSchemaDefinition
> {}
export const projectProvisionedSchema: ProjectProvisionedSchema =
  projectProvisionedSchemaDefinition;
export type ProjectProvisioned = z.infer<typeof projectProvisionedSchema>;

/** The settings form was saved; the slug may have changed with the name. */
const projectSettingsSavedSchemaDefinition = z
  .object({ success: z.boolean(), projectSlug: z.string().min(1) })
  .strict();
export interface ProjectSettingsSavedSchema extends Named<
  typeof projectSettingsSavedSchemaDefinition
> {}
export const projectSettingsSavedSchema: ProjectSettingsSavedSchema =
  projectSettingsSavedSchemaDefinition;
export type ProjectSettingsSaved = z.infer<typeof projectSettingsSavedSchema>;

/** Whether the project has ever received a trace. */
const projectFirstMessageSchemaDefinition = z.object({ firstMessage: z.boolean() }).strict();
export interface ProjectFirstMessageSchema extends Named<
  typeof projectFirstMessageSchemaDefinition
> {}
export const projectFirstMessageSchema: ProjectFirstMessageSchema =
  projectFirstMessageSchemaDefinition;
export type ProjectFirstMessage = z.infer<typeof projectFirstMessageSchema>;

/** A freshly rotated legacy project write credential. */
const projectApiKeyRotationSchemaDefinition = z.object({ apiKey: z.string().min(1) }).strict();
export interface ProjectApiKeyRotationSchema extends Named<
  typeof projectApiKeyRotationSchemaDefinition
> {}
export const projectApiKeyRotationSchema: ProjectApiKeyRotationSchema =
  projectApiKeyRotationSchemaDefinition;
export type ProjectApiKeyRotation = z.infer<typeof projectApiKeyRotationSchema>;

/** Whether a legacy project key still authenticates; never the key or any part of it. */
const projectLegacyKeyStatusSchemaDefinition = z.object({ present: z.boolean() }).strict();
export interface ProjectLegacyKeyStatusSchema extends Named<
  typeof projectLegacyKeyStatusSchemaDefinition
> {}
export const projectLegacyKeyStatusSchema: ProjectLegacyKeyStatusSchema =
  projectLegacyKeyStatusSchemaDefinition;
export type ProjectLegacyKeyStatus = z.infer<typeof projectLegacyKeyStatusSchema>;

/** The legacy project key is gone for good; the answer never carries a key. */
const projectApiKeyRevokedSchemaDefinition = z.object({ revoked: z.literal(true) }).strict();
export interface ProjectApiKeyRevokedSchema extends Named<
  typeof projectApiKeyRevokedSchemaDefinition
> {}
export const projectApiKeyRevokedSchema: ProjectApiKeyRevokedSchema =
  projectApiKeyRevokedSchemaDefinition;
export type ProjectApiKeyRevoked = z.infer<typeof projectApiKeyRevokedSchema>;

/** Archiving is idempotent, and says which of the two happened. */
const projectArchivedSchemaDefinition = z
  .object({ success: z.literal(true), alreadyArchived: z.boolean() })
  .strict();
export interface ProjectArchivedSchema extends Named<typeof projectArchivedSchemaDefinition> {}
export const projectArchivedSchema: ProjectArchivedSchema = projectArchivedSchemaDefinition;
export type ProjectArchived = z.infer<typeof projectArchivedSchema>;

/**
 * One project as `/api/projects` answers it: identity, setup fields, team —
 * no credential (its own gated route) or archive stamp (never listed).
 */
const projectRestSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string(),
    language: z.string(),
    framework: z.string(),
    teamId: z.string().min(1),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface ProjectRestSchema extends Named<typeof projectRestSchemaDefinition> {}
export const projectRestSchema: ProjectRestSchema = projectRestSchemaDefinition;
export type ProjectRest = z.infer<typeof projectRestSchema>;

/** One project as its own GET and PATCH answer it: the listing's shape plus its PII level. */
const projectRestDetailSchemaDefinition = projectRestSchema.safeExtend({
  piiRedactionLevel: dataPrivacyPiiRedactionLevelSchema,
});
export interface ProjectRestDetailSchema extends Named<typeof projectRestDetailSchemaDefinition> {}
export const projectRestDetailSchema: ProjectRestDetailSchema = projectRestDetailSchemaDefinition;
export type ProjectRestDetail = z.infer<typeof projectRestDetailSchema>;

/** What an archive answers: the project it archived, and when. */
const projectRestArchivedSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    archivedAt: z.date(),
  })
  .strict();
export interface ProjectRestArchivedSchema extends Named<
  typeof projectRestArchivedSchemaDefinition
> {}
export const projectRestArchivedSchema: ProjectRestArchivedSchema =
  projectRestArchivedSchemaDefinition;
export type ProjectRestArchived = z.infer<typeof projectRestArchivedSchema>;

/** An aggregate's rule was replaced; its members are pending until governance reconciles. */
const projectAggregateRuleUpdatedSchemaDefinition = z
  .object({ success: z.literal(true), members: aggregateRuleMembersSchema })
  .strict();
export interface ProjectAggregateRuleUpdatedSchema extends Named<
  typeof projectAggregateRuleUpdatedSchemaDefinition
> {}
export const projectAggregateRuleUpdatedSchema: ProjectAggregateRuleUpdatedSchema =
  projectAggregateRuleUpdatedSchemaDefinition;
export type ProjectAggregateRuleUpdated = z.infer<typeof projectAggregateRuleUpdatedSchema>;

/** Every project an explicit aggregate rule may name, ordered by name. */
const projectAggregateMemberCandidatesSchemaDefinition = z.array(aggregateMemberCandidateSchema);
export interface ProjectAggregateMemberCandidatesSchema extends Named<
  typeof projectAggregateMemberCandidatesSchemaDefinition
> {}
export const projectAggregateMemberCandidatesSchema: ProjectAggregateMemberCandidatesSchema =
  projectAggregateMemberCandidatesSchemaDefinition;
