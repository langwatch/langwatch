import { describe, expect, it } from "vitest";

import {
  createSecretReferencer,
  holdsLiteralCredential,
  httpAgentConfigStoringSecrets,
  httpNodeParametersStoringSecrets,
  httpNodeParametersWithoutCredentials,
  httpNodeParametersWithoutSecrets,
  isCredentialHeader,
  secretReferenceOf,
  withoutLiteralCredential,
} from "../http-node.ts";

function secretStore(initial: Record<string, string> = {}) {
  const values = { ...initial };
  const created: string[] = [];
  const reference = createSecretReferencer({
    values: async () => values,
    create: async ({ name, value }) => {
      created.push(name);
      values[name] = value;
    },
  });

  return { reference, values, created };
}

describe("a credential typed into an HTTP node", () => {
  describe("when deciding whether a value is a literal", () => {
    it("treats blanks, references and a scheme in front of a reference as safe", () => {
      expect(holdsLiteralCredential("")).toBe(false);
      expect(holdsLiteralCredential("{{ secrets.PARTNER_TOKEN }}")).toBe(false);
      expect(holdsLiteralCredential("Bearer {{secrets.PARTNER_TOKEN}}")).toBe(false);
    });

    /** @scenario A credential that only wraps secret references is kept as references */
    it("treats references behind a scheme word or joined by separators as references", () => {
      expect(holdsLiteralCredential("ApiKey {{ secrets.K }}")).toBe(false);
      expect(holdsLiteralCredential("key={{ secrets.K }}")).toBe(false);
      expect(holdsLiteralCredential("{{ secrets.U }}:{{ secrets.P }}")).toBe(false);
      expect(holdsLiteralCredential("Basic {{ secrets.U }}:{{ secrets.P }}")).toBe(false);
    });

    /** @scenario A credential that only wraps secret references is kept as references */
    it("matches a listed scheme in any case", () => {
      expect(holdsLiteralCredential("bearer {{ secrets.K }}")).toBe(false);
      expect(holdsLiteralCredential("APIKEY {{ secrets.K }}")).toBe(false);
      expect(holdsLiteralCredential("TOKEN {{ secrets.K }}")).toBe(false);
    });

    /** @scenario A credential that only wraps secret references is kept as references */
    it("treats any field label before `=` or `:` as part of a reference", () => {
      expect(holdsLiteralCredential("hunter={{ secrets.X }}")).toBe(false);
      expect(holdsLiteralCredential("api_key={{ secrets.X }}")).toBe(false);
      expect(holdsLiteralCredential("x-api-key: {{ secrets.X }}")).toBe(false);
      expect(holdsLiteralCredential("key2={{ secrets.X }}")).toBe(false);
    });

    /** @scenario A credential that only wraps secret references is kept as references */
    it("treats a token-shaped or overlong label as a literal", () => {
      expect(holdsLiteralCredential("ghp_abc123def456={{ secrets.X }}")).toBe(true);
      expect(holdsLiteralCredential("sk-proj-AbC1x9Qz7Lm2Pq8:{{ secrets.X }}")).toBe(true);
      expect(holdsLiteralCredential(`${"a".repeat(33)}={{ secrets.X }}`)).toBe(true);
      expect(holdsLiteralCredential(`${"a".repeat(32)}={{ secrets.X }}`)).toBe(false);
    });

    /** @scenario A credential that only wraps secret references is kept as references */
    it("treats any other word before a space and a reference as a literal", () => {
      expect(holdsLiteralCredential("hunter {{ secrets.X }}")).toBe(true);
      expect(holdsLiteralCredential("abc123 {{ secrets.X }}")).toBe(true);
      expect(holdsLiteralCredential("Bearer extra {{ secrets.X }}")).toBe(true);
    });

    /** @scenario A credential that only wraps secret references is kept as references */
    it("stores a value with any other word before a reference as a new secret", async () => {
      const { reference, created, values } = secretStore();
      const config = await httpAgentConfigStoringSecrets({
        config: { headers: [{ key: "Authorization", value: "hunter {{ secrets.X }}" }] },
        owner: "api",
        reference,
      });

      expect(created).toHaveLength(1);
      expect(Object.values(values)).toEqual(["hunter {{ secrets.X }}"]);
      expect(config.headers?.[0]?.value).toBe(`{{ secrets.${created[0]} }}`);
    });

    /** @scenario A credential that only wraps secret references is kept as references */
    it("stores nothing for such a value and keeps it as typed", async () => {
      const { reference, created } = secretStore();
      const config = await httpAgentConfigStoringSecrets({
        config: { headers: [{ key: "Authorization", value: "ApiKey {{ secrets.K }}" }] },
        owner: "api",
        reference,
      });

      expect(created).toEqual([]);
      expect(config.headers).toEqual([{ key: "Authorization", value: "ApiKey {{ secrets.K }}" }]);
    });

    it("treats a token, even beside a reference, as a literal", () => {
      expect(holdsLiteralCredential("abc123")).toBe(true);
      expect(holdsLiteralCredential("abc{{ secrets.PARTNER_TOKEN }}")).toBe(true);
    });

    it("blanks a literal on a read and keeps a reference", () => {
      expect(withoutLiteralCredential("abc123")).toBe("");
      expect(withoutLiteralCredential("{{ secrets.PARTNER_TOKEN }}")).toBe(
        "{{ secrets.PARTNER_TOKEN }}",
      );
    });

    it("answers a loosely typed reference in the one spelling the editor reads", () => {
      const read = withoutLiteralCredential(" bearer {{secrets.PARTNER_TOKEN}} ");

      expect(read).toBe("Bearer {{ secrets.PARTNER_TOKEN }}");
      expect(secretReferenceOf(read)).toBe("PARTNER_TOKEN");
    });
  });

  describe("when naming the secret a stored value points at", () => {
    it.each([
      ["{{ secrets.PARTNER_TOKEN }}", "PARTNER_TOKEN"],
      ["Bearer {{ secrets.PARTNER_TOKEN }}", "PARTNER_TOKEN"],
      ["Basic {{ secrets.HTTP_A_AUTH_PASSWORD_2 }}", "HTTP_A_AUTH_PASSWORD_2"],
    ])("reads %s as the secret %s", (value, name) => {
      expect(secretReferenceOf(value)).toBe(name);
    });

    it.each([["tok_live_123"], ["abc{{ secrets.PARTNER_TOKEN }}"], [""]])(
      "reads %s as no reference",
      (value) => {
        expect(secretReferenceOf(value)).toBeUndefined();
      },
    );
  });

  describe("when deciding whether a header carries a credential", () => {
    /** @scenario One test decides which headers are credentials */
    it.each([
      ["Authorization"],
      ["X-Api-Key"],
      ["Cookie"],
      ["Proxy-Authorization"],
      ["Ocp-Apim-Subscription-Key"],
      ["X-Access-Token"],
      ["X-Client-Secret"],
      ["X-Auth"],
      ["Db-Password"],
    ])("counts %s", (key) => {
      expect(isCredentialHeader(key)).toBe(true);
    });

    /** @scenario One test decides which headers are credentials */
    it.each([["Content-Type"], ["Accept"], ["X-Request-Id"], ["X-Tenant"]])(
      "does not count %s, so a read answers it as typed",
      (key) => {
        expect(isCredentialHeader(key)).toBe(false);
      },
    );
  });

  describe("when a node's parameters are stored", () => {
    /** @scenario A token typed into an HTTP node is stored as a project secret and never read back */
    it("replaces each literal credential with a reference to a project secret", async () => {
      const { reference, values } = secretStore();

      const stored = await httpNodeParametersStoringSecrets({
        owner: "Partner API",
        reference,
        parameters: [
          { identifier: "url", value: "https://partner.example" },
          { identifier: "auth_token", value: "tok_live_123" },
          { identifier: "headers", value: { Authorization: "Bearer abc", "X-Env": "prod" } },
        ],
      });
      const read = httpNodeParametersWithoutSecrets([
        { identifier: "headers", value: { "X-Env": "prod", "X-Api-Key": "key_literal" } },
      ]);

      expect(read).toEqual([{ identifier: "headers", value: { "X-Env": "prod", "X-Api-Key": "" } }]);

      expect(stored).toEqual([
        { identifier: "url", value: "https://partner.example" },
        { identifier: "auth_token", value: "{{ secrets.HTTP_PARTNER_API_AUTH_TOKEN }}" },
        {
          identifier: "headers",
          value: {
            Authorization: "{{ secrets.HTTP_PARTNER_API_HEADER_AUTHORIZATION }}",
            "X-Env": "prod",
          },
        },
      ]);
      expect(values).toEqual({
        HTTP_PARTNER_API_AUTH_TOKEN: "tok_live_123",
        HTTP_PARTNER_API_HEADER_AUTHORIZATION: "Bearer abc",
      });
      expect(JSON.stringify(stored)).not.toContain("tok_live_123");
      expect(JSON.stringify(httpNodeParametersWithoutSecrets(stored))).not.toContain("tok_live");
    });

    it("leaves a reference and a blank as they are and stores nothing", async () => {
      const { reference, created } = secretStore();
      const parameters = [
        { identifier: "auth_token", value: "{{ secrets.PARTNER_TOKEN }}" },
        { identifier: "auth_password", value: "" },
      ];

      expect(await httpNodeParametersStoringSecrets({ owner: "A", reference, parameters })).toEqual(
        parameters,
      );
      expect(created).toEqual([]);
    });

    /** @scenario A token typed into an HTTP node is stored as a project secret and never read back */
    it("stores and blanks the credential inside an auth dict parameter", async () => {
      const { reference, values } = secretStore();
      const parameters = [{ identifier: "auth", value: { type: "bearer", token: "tok_dict_123" } }];

      const stored = await httpNodeParametersStoringSecrets({ owner: "A", reference, parameters });

      expect(stored).toEqual([
        { identifier: "auth", value: { type: "bearer", token: "{{ secrets.HTTP_A_AUTH_TOKEN }}" } },
      ]);
      expect(values).toEqual({ HTTP_A_AUTH_TOKEN: "tok_dict_123" });
      expect(httpNodeParametersWithoutSecrets(parameters)).toEqual([
        { identifier: "auth", value: { type: "bearer", token: "" } },
      ]);
    });

    /** @scenario A copy into another project arrives with blank credentials */
    it("blanks references too for a copy into another project", () => {
      expect(
        httpNodeParametersWithoutCredentials([
          { identifier: "auth_token", value: "{{ secrets.HTTP_A_AUTH_TOKEN }}" },
          { identifier: "headers", value: { "X-Api-Key": "{{ secrets.K }}", Accept: "*/*" } },
        ]),
      ).toEqual([
        { identifier: "auth_token", value: "" },
        { identifier: "headers", value: { "X-Api-Key": "", Accept: "*/*" } },
      ]);
    });

    /** @scenario Two saves storing the same new token at once both succeed */
    it("reuses or numbers on when a concurrent save took the name first", async () => {
      const values: Record<string, string> = {};
      let raced = false;
      const reference = createSecretReferencer({
        values: async () => ({ ...values }),
        create: async ({ name, value }) => {
          if (!raced) {
            raced = true;
            values[name] = "another save's token";
            throw new Error("name taken");
          }
          values[name] = value;
        },
      });

      const answered = await reference({ owner: "api", field: "auth_token", value: "mine" });

      expect(answered).toBe("{{ secrets.HTTP_API_AUTH_TOKEN_2 }}");
      expect(values).toEqual({
        HTTP_API_AUTH_TOKEN: "another save's token",
        HTTP_API_AUTH_TOKEN_2: "mine",
      });
    });

    it("numbers a name another token already holds, and reuses the name for the same token", async () => {
      const { reference, created } = secretStore({ HTTP_API_AUTH_TOKEN: "other" });

      const first = await reference({ owner: "api", field: "auth_token", value: "mine" });
      const again = await reference({ owner: "api", field: "auth_token", value: "mine" });

      expect(first).toBe("{{ secrets.HTTP_API_AUTH_TOKEN_2 }}");
      expect(again).toBe(first);
      expect(created).toEqual(["HTTP_API_AUTH_TOKEN_2"]);
    });
  });

  describe("when an HTTP agent's config is stored", () => {
    /** @scenario A token typed into an HTTP agent is stored as a project secret and never read back */
    it("stores the auth token and credential headers, and keeps the rest", async () => {
      const { reference, values } = secretStore();

      const stored = await httpAgentConfigStoringSecrets({
        owner: "Support bot",
        reference,
        config: {
          auth: { type: "bearer", token: "tok_live_123" },
          headers: [
            { key: "X-Api-Key", value: "key_456" },
            { key: "Accept", value: "application/json" },
          ],
        },
      });

      expect(stored).toEqual({
        auth: { type: "bearer", token: "{{ secrets.HTTP_SUPPORT_BOT_AUTH_TOKEN }}" },
        headers: [
          { key: "X-Api-Key", value: "{{ secrets.HTTP_SUPPORT_BOT_HEADER_X_API_KEY }}" },
          { key: "Accept", value: "application/json" },
        ],
      });
      expect(Object.values(values)).toEqual(["tok_live_123", "key_456"]);
    });
  });
});
