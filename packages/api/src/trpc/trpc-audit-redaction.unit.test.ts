/**
 * The audit trail stores a mutation's input verbatim, and `customKeys` carries provider API keys exactly as the
 * customer typed them. Credential probing became a mutation so the key would stop travelling in a URL — which
 * would have moved it straight into a durable, queryable table instead had this not gone in alongside.
 */
import { describe, expect, it } from "vitest";

import { redactAuditArgs } from "./trpc-audit-redaction.js";

describe("redactAuditArgs", () => {
  describe("given input carrying provider credentials", () => {
    describe("when it is recorded in the audit trail", () => {
      /** @scenario "A credential is never persisted to the audit trail" */
      it("replaces the values but keeps which credentials were set", () => {
        const redacted = redactAuditArgs({
          input: {
            organizationId: "org-1",
            provider: "gemini",
            customKeys: {
              GEMINI_API_KEY: "AIzaSyTheCustomersRealKey",
            },
          },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("AIzaSyTheCustomersRealKey");
        expect(redacted.customKeys).toEqual({
          GEMINI_API_KEY: "[redacted]",
        });
        // The rest of the record is what makes it worth keeping.
        expect(redacted.provider).toBe("gemini");
        expect(redacted.organizationId).toBe("org-1");
      });

      it("redacts every credential, not only the first", () => {
        const redacted = redactAuditArgs({
          input: {
            customKeys: {
              AZURE_OPENAI_API_KEY: "secret-one",
              AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
            },
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
          input: {
            extraHeaders: [
              { key: "Authorization", value: "Bearer sk-the-real-token" },
              { key: "X-Tenant", value: "acme" },
            ],
          },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("sk-the-real-token");
        expect(redacted.extraHeaders).toEqual([
          { key: "Authorization", value: "[redacted]" },
          { key: "X-Tenant", value: "[redacted]" },
        ]);
      });

      // A header that does not carry the `{ key, value }` shape the schema
      // declares still carries whatever was typed into it.
      /** @scenario "A credential typed as a header is never persisted either" */
      it("replaces a header entry of any other shape", () => {
        const redacted = redactAuditArgs({
          input: {
            extraHeaders: [
              "Authorization: Bearer sk-a-bare-string",
              { raw: "Bearer sk-in-another-field" },
              { key: 7, value: "sk-under-a-numeric-name" },
            ],
          },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("sk-");
        expect(redacted.extraHeaders).toEqual(["[redacted]", "[redacted]", "[redacted]"]);
      });

      /** A passthrough object, so its contents cannot be assumed harmless. */
      it("redacts providerConfig values", () => {
        const redacted = redactAuditArgs({
          input: {
            providerConfig: { serviceAccountJson: '{"private_key":"pk"}' },
          },
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
          input: { customKeys: ["sk-off-schema-but-still-a-secret"] },
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("off-schema");
      });

      it("redacts every credential-carrying field on one write", () => {
        const redacted = redactAuditArgs({
          input: {
            provider: "custom",
            customKeys: { CUSTOM_API_KEY: "key-secret" },
            extraHeaders: [{ key: "Authorization", value: "header-secret" }],
            providerConfig: { token: "config-secret" },
          },
        }) as Record<string, unknown>;

        const serialized = JSON.stringify(redacted);
        expect(serialized).not.toContain("key-secret");
        expect(serialized).not.toContain("header-secret");
        expect(serialized).not.toContain("config-secret");
        expect(redacted.provider).toBe("custom");
      });
    });
  });

  describe("given a mutation that carries a key in a named field", () => {
    describe("when it is recorded", () => {
      /** @scenario "The licence signing private key is never persisted to the audit trail" */
      it("keeps no part of the licence signing private key", () => {
        const redacted = redactAuditArgs({
          input: {
            organizationId: "org-1",
            privateKey:
              "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANTheRealSigningKey\n-----END PRIVATE KEY-----",
            organizationName: "Acme",
            email: "ops@acme.example",
            planType: "ENTERPRISE",
            plan: { maxMembers: 50, canPublish: true, usageUnit: "traces" },
          },
          action: "license.generate",
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("TheRealSigningKey");
        expect(JSON.stringify(redacted)).not.toContain("BEGIN PRIVATE KEY");
        expect(redacted.privateKey).toBe("[redacted]");
        expect(redacted.organizationName).toBe("Acme");
        expect(redacted.planType).toBe("ENTERPRISE");
      });

      /** @scenario "An uploaded licence key is never persisted to the audit trail" */
      it("keeps no part of an uploaded licence key", () => {
        const redacted = redactAuditArgs({
          input: { organizationId: "org-1", licenseKey: "eyJhbGciOiJSUzI1NiJ9.TheRealBearer" },
          action: "license.upload",
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("TheRealBearer");
        expect(redacted.organizationId).toBe("org-1");
      });

      /** @scenario "A credential is never persisted to the audit trail" */
      it.each(["secrets.create", "secrets.update"])("redacts a secret value on %s", (action) => {
        const redacted = redactAuditArgs({
          input: { projectId: "proj-1", name: "STRIPE_KEY", value: "sk-live-TheRealSecret" },
          action,
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("TheRealSecret");
        expect(redacted.name).toBe("STRIPE_KEY");
      });

      // The per-action list can never be complete: the next mutation that
      // takes a key writes plaintext until someone remembers to add it.
      /** @scenario "A credential-named field is redacted on a mutation nobody listed" */
      it.each([
        "privateKey",
        "apiKey",
        "sharedSecret",
        "clientSecret",
        "accessToken",
        "password",
        "signingKey",
        "licenseKey",
        "slackWebhook",
        "webhookUrl",
        "credentials",
        "authorization",
      ])("redacts %s on an action with no rule of its own", (field) => {
        const redacted = redactAuditArgs({
          input: { projectId: "proj-1", [field]: "TheRealSecret" },
          action: "someFeature.update",
        }) as Record<string, unknown>;

        expect(JSON.stringify(redacted)).not.toContain("TheRealSecret");
        expect(redacted.projectId).toBe("proj-1");
      });

      /** @scenario "A credential nested inside an input object is redacted too" */
      it("redacts a credential nested inside an object and inside a list", () => {
        const redacted = redactAuditArgs({
          input: {
            projectId: "proj-1",
            destinationConfig: {
              destinations: [
                { type: "webhook", url: "https://siem.example", sharedSecret: "TheRealSecret" },
              ],
            },
          },
          action: "anomalyRules.create",
        });

        expect(JSON.stringify(redacted)).not.toContain("TheRealSecret");
        expect(JSON.stringify(redacted)).toContain("https://siem.example");
      });
    });
  });

  describe("given input with no credentials in it", () => {
    describe("when it is recorded", () => {
      it("passes the arguments through untouched", () => {
        const input = { projectId: "proj-1", name: "Gemini" };

        expect(redactAuditArgs({ input })).toBe(input);
      });

      it.each([undefined, null, "a string", 42])("leaves %s alone", (input) => {
        expect(redactAuditArgs({ input })).toBe(input);
      });

      it("leaves a non-object customKeys alone", () => {
        const input = { customKeys: null };

        expect(redactAuditArgs({ input })).toBe(input);
      });

      it("leaves a non-array extraHeaders alone", () => {
        const input = { extraHeaders: null };

        expect(redactAuditArgs({ input })).toBe(input);
      });

      // Plural counts are numbers on nearly every model write; a name rule
      // that ate them would redact the record instead of protecting it.
      /** @scenario "A token count is not mistaken for a credential" */
      it("leaves token counts alone", () => {
        const input = { maxTokens: 4096, promptTokens: 12, completionTokens: 30 };

        expect(redactAuditArgs({ input, action: "prompts.update" })).toBe(input);
      });
    });
  });

  describe("given a run started with parameter values", () => {
    describe("when the action is one that can carry a secret parameter", () => {
      /** @scenario "Audit log entries never record a secret value" */
      it.each(["suites.run", "scenarios.run"])(
        "keeps the names and drops every value on %s",
        (action) => {
          const redacted = redactAuditArgs({
            input: {
              projectId: "proj-1",
              parameters: { api_token: "tok-live-1", region: "eu-central" },
            },
            action,
          }) as Record<string, unknown>;

          expect(JSON.stringify(redacted)).not.toContain("tok-live-1");
          expect(redacted.parameters).toEqual({
            api_token: "[redacted]",
            region: "[redacted]",
          });
          expect(redacted.projectId).toBe("proj-1");
        },
      );

      /** @scenario "Audit log entries never record a secret value" */
      it("redacts the values typed into the http test button", () => {
        const redacted = redactAuditArgs({
          input: {
            projectId: "proj-1",
            url: "https://api.example.com/chat",
            templateVariables: { token: "tok-live-1" },
          },
          action: "httpProxy.execute",
        }) as Record<string, unknown>;

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

        expect(redactAuditArgs({ input, action: "agents.update" })).toBe(input);
        expect(redactAuditArgs({ input })).toBe(input);
      });
    });
  });
});
