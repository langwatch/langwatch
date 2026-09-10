/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it, vi } from "vitest";

import {
  resolveVoicePhoneConfig,
  resolveVoicePhoneConfigValue,
  VOICE_PHONE_MAX_CALL_DURATION_SECONDS,
  voicePhoneConfigSchema,
} from "../voice-phone-config";

describe("voicePhoneConfigSchema", () => {
  it("accepts an allowlist of E.164 numbers and defaults it to empty", () => {
    expect(voicePhoneConfigSchema.parse({}).allowedCallees).toEqual([]);
    expect(
      voicePhoneConfigSchema.parse({ allowedCallees: [" +14155550123 "] })
        .allowedCallees,
    ).toEqual(["+14155550123"]);
  });

  it("rejects a callee that is not E.164", () => {
    expect(() =>
      voicePhoneConfigSchema.parse({ allowedCallees: ["415-555-0123"] }),
    ).toThrow();
  });

  it("rejects a duration cap above the ceiling", () => {
    expect(() =>
      voicePhoneConfigSchema.parse({
        maxCallDurationSeconds: VOICE_PHONE_MAX_CALL_DURATION_SECONDS + 1,
      }),
    ).toThrow();
  });
});

describe("resolveVoicePhoneConfigValue", () => {
  it("folds an absent column onto deny-by-default with the ceiling cap", () => {
    expect(resolveVoicePhoneConfigValue(null)).toEqual({
      allowedCallees: [],
      maxCallDurationSeconds: VOICE_PHONE_MAX_CALL_DURATION_SECONDS,
    });
  });

  it("keeps a configured allowlist and cap", () => {
    expect(
      resolveVoicePhoneConfigValue({
        allowedCallees: ["+14155550123"],
        maxCallDurationSeconds: 120,
      }),
    ).toEqual({
      allowedCallees: ["+14155550123"],
      maxCallDurationSeconds: 120,
    });
  });
});

describe("resolveVoicePhoneConfig", () => {
  it("delegates to Prisma for the one column and folds the result", async () => {
    const findUnique = vi.fn(async () => ({
      voicePhoneConfig: { allowedCallees: ["+14155550123"] },
    }));
    const prisma = { project: { findUnique } } as unknown as Parameters<
      typeof resolveVoicePhoneConfig
    >[0]["prisma"];

    const resolved = await resolveVoicePhoneConfig({
      projectId: "project-1",
      prisma,
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "project-1" },
      select: { voicePhoneConfig: true },
    });
    expect(resolved).toEqual({
      allowedCallees: ["+14155550123"],
      maxCallDurationSeconds: VOICE_PHONE_MAX_CALL_DURATION_SECONDS,
    });
  });

  it("is deny-by-default when the project row is missing", async () => {
    const prisma = {
      project: { findUnique: vi.fn(async () => null) },
    } as unknown as Parameters<typeof resolveVoicePhoneConfig>[0]["prisma"];

    const resolved = await resolveVoicePhoneConfig({
      projectId: "gone",
      prisma,
    });

    expect(resolved.allowedCallees).toEqual([]);
  });
});
