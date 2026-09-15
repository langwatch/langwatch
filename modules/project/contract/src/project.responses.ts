/**
 * What the project's transports answer, stated once: the tRPC chain declares
 * each procedure's `withOutput` from here, so the shape a client reads is in
 * the contract rather than implied by whatever a handler happened to return.
 */

// Checked against real answers in development and test; production returns
// the handler's own value.

import { z } from "zod";

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

/**
 * Whether this viewer may read captured input and output, and the human label
 * of who can when they may not.
 */
export const projectFieldRedactionStatusSchema = z
  .object({
    isRedacted: z.object({ input: z.boolean(), output: z.boolean() }).strict(),
    visibleTo: z.object({ input: z.string().nullable(), output: z.string().nullable() }).strict(),
  })
  .strict();
export type ProjectFieldRedactionStatus = z.infer<typeof projectFieldRedactionStatusSchema>;

/** Archiving is idempotent, and says which of the two happened. */
export const projectArchivedSchema = z
  .object({ success: z.literal(true), alreadyArchived: z.boolean() })
  .strict();
export type ProjectArchived = z.infer<typeof projectArchivedSchema>;

/** What a manual clustering request did, which is not always "started a run". */
export const topicClusteringRequestSchema = z.union([
  z.object({ started: z.literal(true) }).strict(),
  z.object({ started: z.literal(false), reason: z.literal("already_running") }).strict(),
]);
export type TopicClusteringRequest = z.infer<typeof topicClusteringRequestSchema>;

/** One entity the caller touched recently, as the home strip renders it. */
export const recentItemSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["prompt", "workflow", "dataset", "evaluation", "annotation", "simulation"]),
    name: z.string(),
    href: z.string(),
    updatedAt: z.date(),
  })
  .strict();
export type RecentItem = z.infer<typeof recentItemSchema>;

/**
 * How far a project has been set up. Nine of the eleven figures belong to
 * other verticals and arrive already counted; the last two are the project's
 * own columns, and every count reads as "more than none".
 */
export const integrationsCheckStatusSchema = z
  .object({
    workflows: z.number(),
    customGraphs: z.number(),
    datasets: z.number(),
    onlineEvaluations: z.number(),
    triggers: z.number(),
    simulations: z.number(),
    modelProviders: z.number(),
    prompts: z.number(),
    teamMembers: z.number(),
    firstMessage: z.boolean(),
    integrated: z.boolean(),
  })
  .strict();
export type IntegrationsCheckStatus = z.infer<typeof integrationsCheckStatusSchema>;

/**
 * One project, as the `/api/projects` management family answers it: the
 * identity, the two setup fields and the team it sits in. The stored row's
 * credential and its archive stamp are deliberately absent — the credential
 * has its own gated route, and an archived project is not listed.
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

/** A page of them, with the count the caller pages through. */
export const projectRestPageSchema = z
  .object({
    data: z.array(projectRestSchema),
    pagination: z
      .object({
        page: z.number().int().positive(),
        limit: z.number().int().positive(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type ProjectRestPage = z.infer<typeof projectRestPageSchema>;

/**
 * A freshly created project, with the service key minted alongside it. The
 * token is shown once, on this response only.
 */
export const projectRestCreatedSchema = projectRestSchema.extend({
  serviceApiKey: z.string().min(1),
  serviceApiKeyId: z.string().min(1),
});
export type ProjectRestCreated = z.infer<typeof projectRestCreatedSchema>;

/** What an archive answers: the project it archived, and when. */
export const projectRestArchivedSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    archivedAt: z.date().nullable(),
  })
  .strict();
export type ProjectRestArchived = z.infer<typeof projectRestArchivedSchema>;
