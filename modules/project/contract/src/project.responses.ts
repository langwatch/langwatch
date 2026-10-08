/**
 * What the project's transports answer, stated once: the tRPC chain declares
 * each procedure's `withOutput` from here, so the shape a client reads is in
 * the contract rather than implied by whatever a handler happened to return.
 */

// Checked against real answers in development and test; production returns
// the handler's own value.

import { dataPrivacyPiiRedactionLevelSchema } from "@langwatch/data-privacy-contract";
import { z } from "zod";

import { aggregateMemberCandidateSchema } from "./aggregate-rule.ts";

/** A project was provisioned; the slug is what the caller navigates to. */
export const projectProvisionedSchema = z
  .object({ success: z.literal(true), projectSlug: z.string().min(1) })
  .strict();
export type ProjectProvisioned = z.infer<typeof projectProvisionedSchema>;

/** The settings form was saved; the slug may have changed with the name. */
export const projectSettingsSavedSchema = z
  .object({ success: z.boolean(), projectSlug: z.string().min(1) })
  .strict();
export type ProjectSettingsSaved = z.infer<typeof projectSettingsSavedSchema>;

/** Whether the project has ever received a trace. */
export const projectFirstMessageSchema = z.object({ firstMessage: z.boolean() }).strict();
export type ProjectFirstMessage = z.infer<typeof projectFirstMessageSchema>;

/** A freshly rotated legacy project write credential. */
export const projectApiKeyRotationSchema = z.object({ apiKey: z.string().min(1) }).strict();
export type ProjectApiKeyRotation = z.infer<typeof projectApiKeyRotationSchema>;

/** Whether a legacy project key still authenticates; never the key or any part of it. */
export const projectLegacyKeyStatusSchema = z.object({ present: z.boolean() }).strict();
export type ProjectLegacyKeyStatus = z.infer<typeof projectLegacyKeyStatusSchema>;

/** The legacy project key is gone for good; the answer never carries a key. */
export const projectApiKeyRevokedSchema = z.object({ revoked: z.literal(true) }).strict();
export type ProjectApiKeyRevoked = z.infer<typeof projectApiKeyRevokedSchema>;

/** Archiving is idempotent, and says which of the two happened. */
export const projectArchivedSchema = z
  .object({ success: z.literal(true), alreadyArchived: z.boolean() })
  .strict();
export type ProjectArchived = z.infer<typeof projectArchivedSchema>;

/**
 * One project as `/api/projects` answers it: identity, setup fields, team —
 * no credential (its own gated route) or archive stamp (never listed).
 */
export const projectRestSchema = z
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
export type ProjectRest = z.infer<typeof projectRestSchema>;

/** One project as its own GET and PATCH answer it: the listing's shape plus its PII level. */
export const projectRestDetailSchema = projectRestSchema.safeExtend({
  piiRedactionLevel: dataPrivacyPiiRedactionLevelSchema,
});
export type ProjectRestDetail = z.infer<typeof projectRestDetailSchema>;

/** What an archive answers: the project it archived, and when. */
export const projectRestArchivedSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    archivedAt: z.date(),
  })
  .strict();
export type ProjectRestArchived = z.infer<typeof projectRestArchivedSchema>;

/** ADR-175: every project an admin may pick for an aggregate, personal ones naming their owner. */
export const projectAggregateMemberCandidatesSchema = z.array(aggregateMemberCandidateSchema);
