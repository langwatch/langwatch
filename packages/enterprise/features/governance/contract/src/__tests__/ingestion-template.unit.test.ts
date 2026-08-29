import { describe, expect, it } from "vitest";
import {
  PLATFORM_INGESTION_TEMPLATES,
  RETIRED_PLATFORM_TEMPLATE_SLUGS,
  createIngestionTemplateInputSchema,
  ingestionTemplateSchema,
  ingestionTemplateSourceTypeSchema,
} from "../index";

describe("ingestion template contract", () => {
  it("uses Zod 4 schemas for the portable template shape", () => {
    expect(
      ingestionTemplateSchema.parse({
        id: "template-1",
        slug: "custom_template_abc123",
        sourceType: "custom_source",
        displayName: "Custom template",
        description: null,
        iconAsset: null,
        credentialSchema: null,
        ottlRules: "",
        platformPublished: false,
        enabled: true,
        organizationId: "organization-1",
      }),
    ).toMatchObject({ sourceType: "custom_source" });
  });

  it("rejects source types outside the stable wire format", () => {
    expect(ingestionTemplateSourceTypeSchema.safeParse("Invalid Source!").success).toBe(
      false,
    );
    expect(
      createIngestionTemplateInputSchema.safeParse({
        organizationId: "organization-1",
        callerUserId: "user-1",
        sourceType: "valid_source",
        displayName: "",
      }).success,
    ).toBe(false);
  });

  it("ships no platform defaults and retires coding-assistant rows", () => {
    expect(PLATFORM_INGESTION_TEMPLATES).toEqual([]);
    expect(RETIRED_PLATFORM_TEMPLATE_SLUGS).toEqual(
      expect.arrayContaining([
        "claude_code",
        "codex",
        "cursor",
        "gemini",
        "opencode",
        "claude_cowork",
      ]),
    );
  });
});
