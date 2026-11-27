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

/** The templates a staff test can force; "what's new" never sends, so it is not one of them. */
export const DIGEST_FORCEABLE_TEMPLATE_IDS = [
  "digest-plan-pressure",
  "digest-scenarios-trend",
  "digest-coding-agent-week",
  "digest-traces-week",
] as const satisfies readonly DigestTemplateId[];

/** A staff test's template: "auto" is what the person would get today; an id forces that one. */
export const DIGEST_TEST_TEMPLATES = ["auto", ...DIGEST_FORCEABLE_TEMPLATE_IDS] as const;
export const digestTestTemplateSchema = z.enum(DIGEST_TEST_TEMPLATES);
export type DigestTestTemplate = z.infer<typeof digestTestTemplateSchema>;

const digestSettingsSchemaDefinition = z.object({
  /** The weekly send's master switch; off until an operator arms it. */
  armed: z.boolean(),
});
export interface DigestSettingsSchema extends Named<typeof digestSettingsSchemaDefinition> {}
export const digestSettingsSchema: DigestSettingsSchema = digestSettingsSchemaDefinition;
export type DigestSettings = z.infer<typeof digestSettingsSchema>;

const digestSetArmedInputSchemaDefinition = z.object({ armed: z.boolean() });
export interface DigestSetArmedInputSchema extends Named<
  typeof digestSetArmedInputSchemaDefinition
> {}
export const digestSetArmedInputSchema: DigestSetArmedInputSchema =
  digestSetArmedInputSchemaDefinition;
export type DigestSetArmedInput = z.infer<typeof digestSetArmedInputSchema>;

/** A call that names nothing: the signed-in person is the only subject there is. */
const digestNoInputSchemaDefinition = z.object({});
export interface DigestNoInputSchema extends Named<typeof digestNoInputSchemaDefinition> {}
export const digestNoInputSchema: DigestNoInputSchema = digestNoInputSchemaDefinition;

/** Whether a person receives the digest: one choice covering every organization they are in. */
const digestPreferenceSchemaDefinition = z.object({ subscribed: z.boolean() });
export interface DigestPreferenceSchema extends Named<typeof digestPreferenceSchemaDefinition> {}
export const digestPreferenceSchema: DigestPreferenceSchema = digestPreferenceSchemaDefinition;
export type DigestPreference = z.infer<typeof digestPreferenceSchema>;

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

/** Why an organization's test was not sent: nothing went, and nothing is wrong. */
export const DIGEST_MY_TEST_SKIP_REASONS = [
  "nothing_to_send",
  "opted_out",
  "not_a_member",
  /** A forced template had no data to show for the person here. */
  "no_data_for_template",
] as const;

/**
 * One organization's outcome when an operator sends themself every digest they would get: sent
 * with its template, skipped for a reason, or failed (logged; the rest still went).
 */
const digestMyTestSchemaDefinition = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("sent"),
    organizationId: z.string(),
    organizationName: z.string(),
    templateId: digestTemplateIdSchema,
  }),
  z.object({
    outcome: z.literal("skipped"),
    organizationId: z.string(),
    organizationName: z.string(),
    reason: z.enum(DIGEST_MY_TEST_SKIP_REASONS),
  }),
  z.object({
    outcome: z.literal("failed"),
    organizationId: z.string(),
    organizationName: z.string(),
  }),
]);
export interface DigestMyTestSchema extends Named<typeof digestMyTestSchemaDefinition> {}
export const digestMyTestSchema: DigestMyTestSchema = digestMyTestSchemaDefinition;
export type DigestMyTest = z.infer<typeof digestMyTestSchema>;

/** Every organization the operator is an active member of, one outcome each, by name. */
const digestMyTestsSchemaDefinition = z.object({ organizations: z.array(digestMyTestSchema) });
export interface DigestMyTestsSchema extends Named<typeof digestMyTestsSchemaDefinition> {}
export const digestMyTestsSchema: DigestMyTestsSchema = digestMyTestsSchemaDefinition;
export type DigestMyTests = z.infer<typeof digestMyTestsSchema>;

/** The person whose digests the operator is sent, by address, and which template to send. */
const digestSendTestForInputSchemaDefinition = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  template: digestTestTemplateSchema,
});
export interface DigestSendTestForInputSchema extends Named<
  typeof digestSendTestForInputSchemaDefinition
> {}
export const digestSendTestForInputSchema: DigestSendTestForInputSchema =
  digestSendTestForInputSchemaDefinition;
export type DigestSendTestForInput = z.infer<typeof digestSendTestForInputSchema>;

/** Whom the tests were of, and every organization they are an active member of, by name. */
const digestTestsForSchemaDefinition = z.object({
  person: z.object({ name: z.string().nullable(), email: z.string() }),
  organizations: z.array(digestMyTestSchema),
});
export interface DigestTestsForSchema extends Named<typeof digestTestsForSchemaDefinition> {}
export const digestTestsForSchema: DigestTestsForSchema = digestTestsForSchemaDefinition;
export type DigestTestsFor = z.infer<typeof digestTestsForSchema>;

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
