// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Named } from "@langwatch/module";
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

const digestSettingsSchemaDefinition = z.object({
  /** The weekly send's master switch; off until an operator arms it. */
  armed: z.boolean(),
  /** The organizations whose members are sent to; none until an operator enrols one. */
  enrolledOrganizationIds: z.array(z.string()),
});
export interface DigestSettingsSchema extends Named<typeof digestSettingsSchemaDefinition> {}
export const digestSettingsSchema: DigestSettingsSchema = digestSettingsSchemaDefinition;
export type DigestSettings = z.infer<typeof digestSettingsSchema>;

const digestSetEnrolledInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  enrolled: z.boolean(),
});
export interface DigestSetEnrolledInputSchema extends Named<
  typeof digestSetEnrolledInputSchemaDefinition
> {}
export const digestSetEnrolledInputSchema: DigestSetEnrolledInputSchema =
  digestSetEnrolledInputSchemaDefinition;
export type DigestSetEnrolledInput = z.infer<typeof digestSetEnrolledInputSchema>;

const digestSetArmedInputSchemaDefinition = z.object({ armed: z.boolean() });
export interface DigestSetArmedInputSchema extends Named<
  typeof digestSetArmedInputSchemaDefinition
> {}
export const digestSetArmedInputSchema: DigestSetArmedInputSchema =
  digestSetArmedInputSchemaDefinition;
export type DigestSetArmedInput = z.infer<typeof digestSetArmedInputSchema>;

/** The member whose last week the operator who asks is sent, exactly as it would go out. */
const digestSendTestInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});
export interface DigestSendTestInputSchema extends Named<
  typeof digestSendTestInputSchemaDefinition
> {}
export const digestSendTestInputSchema: DigestSendTestInputSchema =
  digestSendTestInputSchemaDefinition;
export type DigestSendTestInput = z.infer<typeof digestSendTestInputSchema>;

const digestAcknowledgedSchemaDefinition = z.object({ ok: z.literal(true) });
export interface DigestAcknowledgedSchema extends Named<
  typeof digestAcknowledgedSchemaDefinition
> {}
export const digestAcknowledgedSchema: DigestAcknowledgedSchema =
  digestAcknowledgedSchemaDefinition;

/** The signed token a digest's unsubscribe link and its RFC 8058 header carry. */
const digestTokenQuerySchemaDefinition = z.object({ token: z.string().min(1).max(512) });
export interface DigestTokenQuerySchema extends Named<typeof digestTokenQuerySchemaDefinition> {}
export const digestTokenQuerySchema: DigestTokenQuerySchema = digestTokenQuerySchemaDefinition;
export type DigestTokenQuery = z.infer<typeof digestTokenQuerySchema>;

/**
 * A token call and who made it: the public routes count one attempt per caller, and a caller
 * whose address is unknown shares one bucket rather than bypassing the count.
 */
export type DigestTokenCall = DigestTokenQuery & { callerAddress: string | null };
