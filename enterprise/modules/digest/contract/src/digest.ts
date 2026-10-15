// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/** The five templates, in the order a person's one weekly email is picked from. */
export const DIGEST_TEMPLATE_IDS = [
  "digest-plan-pressure",
  "digest-scenarios-trend",
  "digest-coding-agent-week",
  "digest-traces-week",
  "digest-whats-new",
] as const;
export const digestTemplateIdSchema = z.enum(DIGEST_TEMPLATE_IDS);
export type DigestTemplateId = z.infer<typeof digestTemplateIdSchema>;

/** An ISO 8601 week, `2026-W39`. */
export const isoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/);
export type IsoWeek = z.infer<typeof isoWeekSchema>;

export const digestAcknowledgedSchema = z.object({ ok: z.literal(true) });
export type DigestAcknowledged = z.infer<typeof digestAcknowledgedSchema>;

export const digestCohortSortSchema = z.enum([
  "codingAgentCost",
  "codingAgentSessions",
  "traces",
  "planUsage",
  "scenarioRuns",
  "members",
  "template",
]);
export type DigestCohortSort = z.infer<typeof digestCohortSortSchema>;

export const digestCohortInputSchema = z.object({
  sort: digestCohortSortSchema.default("codingAgentCost"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
export type DigestCohortInput = z.infer<typeof digestCohortInputSchema>;

/** One organization with folds this week or last: numbers and ids only. */
export const digestCohortRowSchema = z.object({
  organizationId: z.string(),
  isoWeek: isoWeekSchema,
  enrolled: z.boolean(),
  members: z.number().int().nonnegative(),
  traces: z.number().int().nonnegative(),
  scenarioRuns: z.number().int().nonnegative(),
  codingAgentSessions: z.number().int().nonnegative(),
  codingAgentCostUsd: z.number().nonnegative(),
  planUsagePercent: z.number().nonnegative(),
  /** What a member with no coding-agent sessions of their own is sent. */
  template: digestTemplateIdSchema,
});
export type DigestCohortRow = z.infer<typeof digestCohortRowSchema>;

export const digestOrganizationInputSchema = z.object({ organizationId: z.string().min(1) });

/** A member as the gallery lists them; name and email are read at render, never stored. */
export const digestMemberRowSchema = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  admin: z.boolean(),
  subscribed: z.boolean(),
  template: digestTemplateIdSchema,
});
export type DigestMemberRow = z.infer<typeof digestMemberRowSchema>;

export const digestPreviewInputSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});
export type DigestPreviewInput = z.infer<typeof digestPreviewInputSchema>;

export const digestRenderedSchema = z.object({
  templateId: digestTemplateIdSchema,
  picked: z.boolean(),
  subject: z.string(),
  html: z.string(),
});
export type DigestRendered = z.infer<typeof digestRenderedSchema>;

export const digestPreviewSchema = z.object({
  userId: z.string(),
  isoWeek: isoWeekSchema,
  templates: z.array(digestRenderedSchema),
});
export type DigestPreview = z.infer<typeof digestPreviewSchema>;

export const digestSendTestInputSchema = digestPreviewInputSchema.extend({
  templateId: digestTemplateIdSchema.optional(),
});
export type DigestSendTestInput = z.infer<typeof digestSendTestInputSchema>;

export const digestSetEnrolledInputSchema = z.object({
  organizationId: z.string().min(1),
  enrolled: z.boolean(),
});
export type DigestSetEnrolledInput = z.infer<typeof digestSetEnrolledInputSchema>;

export const DIGEST_UPDATE_GRADIENTS = ["ember", "sky", "meadow"] as const;

/** The week's "what's new" card as an operator writes it; the link is tracked when sent. */
export const digestUpdateSchema = z.object({
  isoWeek: isoWeekSchema,
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(600),
  gradient: z.enum(DIGEST_UPDATE_GRADIENTS),
  linkLabel: z.string().min(1).max(60),
  linkUrl: z.url(),
});
export type DigestUpdate = z.infer<typeof digestUpdateSchema>;

export const digestSettingsSchema = z.object({
  armed: z.boolean(),
  /** Members of enrolled organizations: who would receive mail this week. */
  recipients: z.number().int().nonnegative(),
});
export type DigestSettings = z.infer<typeof digestSettingsSchema>;

export const digestSetArmedInputSchema = z.object({ armed: z.boolean() });

export const digestMetricRowSchema = z.object({
  isoWeek: isoWeekSchema,
  templateId: digestTemplateIdSchema,
  sent: z.number().int().nonnegative(),
  clickers: z.number().int().nonnegative(),
  clickRatePercent: z.number().nonnegative(),
  unsubscribes: z.number().int().nonnegative(),
});
export type DigestMetricRow = z.infer<typeof digestMetricRowSchema>;

/** The signed token a digest's unsubscribe link and RFC 8058 header carry. */
export const digestTokenQuerySchema = z.object({ token: z.string().min(1).max(512) });

export const digestUnsubscribePageSchema = z.object({ subscribed: z.boolean() });
export type DigestUnsubscribePage = z.infer<typeof digestUnsubscribePageSchema>;
