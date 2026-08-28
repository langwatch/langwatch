import { describe, expect, it, vi } from "vitest";
import { resolveTracePrivacyRuntimeConfig } from "../trace-privacy.config";

describe("resolveTracePrivacyRuntimeConfig", () => {
  it("keeps the complete service-account document while requiring project_id", () => {
    const config = resolveTracePrivacyRuntimeConfig({
      googleApplicationCredentials: JSON.stringify({
        project_id: "privacy-project",
        client_email: "privacy@example.test",
        private_key: "private-key",
      }),
      googleDlpDisabled: "false",
      langevalsEndpoint: "http://langevals",
    });

    expect(config.googleDlp.credentials).toEqual({
      project_id: "privacy-project",
      client_email: "privacy@example.test",
      private_key: "private-key",
    });
    expect(config.googleDlp.disabled).toBe(false);
  });

  it("keeps DLP unavailable after invalid JSON and reports that reason", () => {
    const invalidCredentials = vi.fn();
    const config = resolveTracePrivacyRuntimeConfig(
      { googleApplicationCredentials: "{not-json" },
      invalidCredentials,
    );

    expect(config.googleDlp.credentials).toBeUndefined();
    expect(invalidCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "invalid-json" }),
    );
  });

  it.each([
    ["omits project_id", { client_email: "privacy@example.test" }],
    ["has a blank project_id", { project_id: "  ", client_email: "privacy@example.test" }],
  ])(
    "keeps DLP unavailable after a valid document %s and reports the missing-project reason",
    (_description, credentials) => {
      const invalidCredentials = vi.fn();
      const config = resolveTracePrivacyRuntimeConfig(
        { googleApplicationCredentials: JSON.stringify(credentials) },
        invalidCredentials,
      );

      expect(config.googleDlp.credentials).toBeUndefined();
      expect(invalidCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "missing-project-id" }),
      );
    },
  );
});
