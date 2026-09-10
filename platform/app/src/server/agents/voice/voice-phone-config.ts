/**
 * Per-project guardrails for phone (Twilio) voice targets.
 *
 * Two knobs live on the project's `voicePhoneConfig` Json column:
 *   - `allowedCallees`: the deny-by-default list of E.164 numbers a phone
 *     target may be dialled at. Empty (or an absent column) denies every
 *     destination, so a-leg origination cannot reach a number an operator has
 *     not explicitly opted into. This mirrors the SDK adapter's own
 *     `allowedCallees` deny-by-default guardrail (#762 guardrail (c)).
 *   - `maxCallDurationSeconds`: the per-call wall-clock cap, clamped to
 *     {@link VOICE_PHONE_MAX_CALL_DURATION_SECONDS}. Absent falls back to the
 *     same ceiling.
 *
 * The Twilio ACCOUNT credentials are not here: they are operator env
 * (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`,
 * `VOICE_PUBLIC_BASE_URL`), read by the transport, never persisted per project.
 *
 * Shares the `langyEgressAllowlist` Json-column shape: a nullable column, a Zod
 * schema both the resolver and any future writer validate through, and an
 * accessor that folds an absent column onto the safe default. No UI yet
 * (langwatch/langwatch#8014).
 */

import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import { E164_PHONE_PATTERN } from "./voice-agent.config";

/**
 * The hard ceiling on a phone call's wall-clock, in seconds. A project's
 * configured cap is clamped to this, and it is the fallback when none is set.
 * Matches the 300 s whole-call budget the rest of the voice stack enforces.
 */
export const VOICE_PHONE_MAX_CALL_DURATION_SECONDS = 300;

const e164Schema = z
  .string()
  .trim()
  .regex(E164_PHONE_PATTERN, "Enter the number in E.164 form, like +14155550123");

/**
 * The stored shape of `Project.voicePhoneConfig`. Both fields are optional in
 * the column; the accessor supplies the deny-by-default and cap fallbacks.
 */
export const voicePhoneConfigSchema = z.object({
  allowedCallees: z.array(e164Schema).default([]),
  maxCallDurationSeconds: z
    .number()
    .int()
    .positive()
    .max(VOICE_PHONE_MAX_CALL_DURATION_SECONDS)
    .optional(),
});
export type VoicePhoneConfig = z.infer<typeof voicePhoneConfigSchema>;

/** The resolved, defaults-applied config the transport reads. */
export interface ResolvedVoicePhoneConfig {
  /** Deny-by-default: empty means no destination may be dialled. */
  allowedCallees: string[];
  /** Always set: the configured cap clamped to the ceiling, else the ceiling. */
  maxCallDurationSeconds: number;
}

/**
 * Fold a stored (or absent) config onto the resolved shape the transport reads.
 * An absent column is deny-by-default with the ceiling cap; a configured cap is
 * clamped rather than trusted, so a stale row can never exceed the ceiling.
 */
export function resolveVoicePhoneConfigValue(
  raw: unknown,
): ResolvedVoicePhoneConfig {
  const parsed = raw == null ? undefined : voicePhoneConfigSchema.parse(raw);
  const cap = parsed?.maxCallDurationSeconds;
  return {
    allowedCallees: parsed?.allowedCallees ?? [],
    maxCallDurationSeconds:
      cap === undefined
        ? VOICE_PHONE_MAX_CALL_DURATION_SECONDS
        : Math.min(cap, VOICE_PHONE_MAX_CALL_DURATION_SECONDS),
  };
}

/**
 * Read a project's phone-target guardrails. Delegates to Prisma for the one
 * column and folds it onto the resolved shape; an absent project or column is
 * deny-by-default, so a phone run for a project that never configured one dials
 * nothing rather than everything.
 */
export async function resolveVoicePhoneConfig({
  projectId,
  prisma,
}: {
  projectId: string;
  prisma: Pick<PrismaClient, "project">;
}): Promise<ResolvedVoicePhoneConfig> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { voicePhoneConfig: true },
  });
  return resolveVoicePhoneConfigValue(project?.voicePhoneConfig ?? null);
}
