/**
 * The audit trail stores a mutation's input verbatim, and `customKeys` carries
 * provider API keys exactly as the customer typed them. Credential probing
 * became a mutation so the key would stop travelling in a URL — which would
 * have moved it straight into a durable, queryable table instead had this not
 * gone in alongside.
 *
 * Covers @unit scenarios from
 * specs/model-providers/credential-validation.feature and
 * specs/scenarios/secret-run-parameters.feature.
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

      // `extraHeaders` rides the same `modelProvider.update` mutation as
      // `customKeys` and is where an `Authorization: Bearer …` is typed, so
      // redacting only the latter leaves the secret in the table anyway.
      /** @scenario "A credential typed as a header is never persisted either" */
      it("redacts a header's value while keeping its name", () => {
        const redacted = redactAuditArgs({
          extraHeaders: [
            { key: "Authorization", value: "Bearer sk-the-real-token" },
            { key: "X-Tenant", value: "acme" },
          ],
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("sk-the-real-token");
        expect(redacted.extraHeaders).toEqual([
          { key: "Authorization", value: "[redacted]" },
          { key: "X-Tenant", value: "[redacted]" },
        ]);
      });

      /** A passthrough object, so its contents cannot be assumed harmless. */
      it("redacts providerConfig values", () => {
        const redacted = redactAuditArgs({
          providerConfig: { serviceAccountJson: '{"private_key":"pk"}' },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("private_key");
        expect(redacted.providerConfig).toEqual({
          serviceAccountJson: "[redacted]",
        });
      });

      // No schema produces this shape. The point is the failure direction:
      // an unexpected shape must not be the one that gets through.
      it("redacts a credential field arriving in an unexpected shape", () => {
        const redacted = redactAuditArgs({
          customKeys: ["sk-off-schema-but-still-a-secret"],
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("off-schema");
      });

      it("redacts every credential-carrying field on one write", () => {
        const redacted = redactAuditArgs({
          provider: "custom",
          customKeys: { CUSTOM_API_KEY: "key-secret" },
          extraHeaders: [{ key: "Authorization", value: "header-secret" }],
          providerConfig: { token: "config-secret" },
        }) as Record<string, unknown>;

        const serialized = JSON.stringify(redacted);
        expect(serialized).not.toContain("key-secret");
        expect(serialized).not.toContain("header-secret");
        expect(serialized).not.toContain("config-secret");
        expect(redacted.provider).toBe("custom");
      });
    });
  });

  describe("given input with no credentials in it", () => {
    describe("when it is recorded", () => {
      it("passes the arguments through untouched", () => {
        const input = { projectId: "proj-1", name: "Gemini" };

        expect(redactAuditArgs(input)).toBe(input);
      });

      it.each([undefined, null, "a string", 42])("leaves %s alone", (input) => {
        expect(redactAuditArgs(input)).toBe(input);
      });

      it("leaves a non-object customKeys alone", () => {
        const input = { customKeys: null };

        expect(redactAuditArgs(input)).toBe(input);
      });

      it("leaves a non-array extraHeaders alone", () => {
        const input = { extraHeaders: null };

        expect(redactAuditArgs(input)).toBe(input);
      });
    });
  });

  describe("given a run started with parameter values", () => {
    describe("when the action is one that can carry a secret parameter", () => {
      /** @scenario "Audit log entries never record a secret value" */
      it.each([
        "suites.run",
        "scenarios.run",
      ])("keeps the names and drops every value on %s", (action) => {
        const redacted = redactAuditArgs(
          {
            projectId: "proj-1",
            parameters: { api_token: "tok-live-1", region: "eu-central" },
          },
          action,
        ) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("tok-live-1");
        expect(redacted.parameters).toEqual({
          api_token: "[redacted]",
          region: "[redacted]",
        });
        expect(redacted.projectId).toBe("proj-1");
      });

      /** @scenario "Audit log entries never record a secret value" */
      it("redacts the values typed into the http test button", () => {
        const redacted = redactAuditArgs(
          {
            projectId: "proj-1",
            url: "https://api.example.com/chat",
            templateVariables: { token: "tok-live-1" },
          },
          "httpProxy.execute",
        ) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("tok-live-1");
        expect(redacted.templateVariables).toEqual({ token: "[redacted]" });
        expect(redacted.url).toBe("https://api.example.com/chat");
      });
    });

    describe("when the action is any other one", () => {
      // `parameters` is an ordinary word: a code agent's config carries one,
      // and its contents are the agent's own code, not a credential.
      it("leaves a parameters field on an unrelated action alone", () => {
        const input = { parameters: { region: "eu-central" } };

        expect(redactAuditArgs(input, "agents.update")).toBe(input);
        expect(redactAuditArgs(input)).toBe(input);
      });
    });
  });
});
