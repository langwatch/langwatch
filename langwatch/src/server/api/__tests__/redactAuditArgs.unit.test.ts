/**
 * The audit trail stores a mutation's input verbatim, and `customKeys` carries
 * provider API keys exactly as the customer typed them. Credential probing
 * became a mutation so the key would stop travelling in a URL — which would
 * have moved it straight into a durable, queryable table instead had this not
 * gone in alongside.
 *
 * Covers @unit scenarios from
 * specs/model-providers/credential-validation.feature.
 */
import { describe, expect, it } from "vitest";

import { redactAuditArgs } from "../trpc";

describe("redactAuditArgs", () => {
  describe("given input carrying provider credentials", () => {
    describe("when it is recorded in the audit trail", () => {
      /** @scenario "A credential is never persisted to the audit trail" */
      it("replaces the values but keeps which credentials were set", () => {
        const redacted = redactAuditArgs({
          organizationId: "org-1",
          provider: "gemini",
          customKeys: {
            GEMINI_API_KEY: "AIzaSyTheCustomersRealKey",
          },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain(
          "AIzaSyTheCustomersRealKey",
        );
        expect(redacted.customKeys).toEqual({
          GEMINI_API_KEY: "[redacted]",
        });
        // The rest of the record is what makes it worth keeping.
        expect(redacted.provider).toBe("gemini");
        expect(redacted.organizationId).toBe("org-1");
      });

      it("redacts every credential, not only the first", () => {
        const redacted = redactAuditArgs({
          customKeys: {
            AZURE_OPENAI_API_KEY: "secret-one",
            AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
          },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("secret-one");
        expect(JSON.stringify(redacted)).not.toContain("example.openai");
      });
    });
  });

  describe("given input with no credentials in it", () => {
    describe("when it is recorded", () => {
      it("passes the arguments through untouched", () => {
        const input = { projectId: "proj-1", name: "Gemini" };

        expect(redactAuditArgs(input)).toBe(input);
      });

      it.each([undefined, null, "a string", 42])(
        "leaves %s alone",
        (input) => {
          expect(redactAuditArgs(input)).toBe(input);
        },
      );

      it("leaves a non-object customKeys alone", () => {
        const input = { customKeys: null };

        expect(redactAuditArgs(input)).toBe(input);
      });
    });
  });
});
