import { describe, expect, it } from "vitest";
import {
  API_KEY_PERMISSION_MODES,
  API_KEY_PREFIX,
  INGEST_KEY_PREFIX,
  LEGACY_PAT_PREFIX,
  apiKeyVisibleProjectsInputSchema,
  apiKeyVisibleProjectsSchema,
  getTokenType,
  splitApiKeyToken,
} from "@langwatch/api-key-contract";

describe("API-key contract", () => {
  it("recognizes current and legacy token classes", () => {
    expect(getTokenType(`${API_KEY_PREFIX}${"a".repeat(16)}_${"b".repeat(48)}`)).toBe("apiKey");
    expect(getTokenType(`${INGEST_KEY_PREFIX}${"a".repeat(16)}_${"b".repeat(48)}`)).toBe("apiKey");
    expect(getTokenType(`${LEGACY_PAT_PREFIX}lookup_secret`)).toBe("apiKey");
    expect(getTokenType("sk-lw-legacy_key")).toBe("legacyProjectKey");
  });

  it("splits the supported bearer token shape", () => {
    expect(splitApiKeyToken(`sk-lw-${"a".repeat(16)}_${"b".repeat(48)}`)).toEqual({
      lookupId: "a".repeat(16),
      secret: "b".repeat(48),
    });
    expect(splitApiKeyToken("unknown-token")).toBeNull();
  });

  it("defines the supported permission modes", () => {
    expect(API_KEY_PERMISSION_MODES).toEqual(["all", "readonly", "restricted"]);
  });

  it("validates bounded project-visibility inputs and results", () => {
    expect(
      apiKeyVisibleProjectsInputSchema.parse({
        apiKeyId: "key-1",
        organizationId: "org-1",
      }),
    ).toEqual({ apiKeyId: "key-1", organizationId: "org-1" });
    expect(
      apiKeyVisibleProjectsSchema.parse({
        kind: "some",
        ids: ["project-1"],
      }),
    ).toEqual({ kind: "some", ids: ["project-1"] });
  });
});
