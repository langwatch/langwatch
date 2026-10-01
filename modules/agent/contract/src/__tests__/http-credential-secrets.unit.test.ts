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

function secretStore(
  initial: Record<string, string> = {},
  initialOrigins: Record<string, string> = {},
) {
  const values = { ...initial };
  const origins = { ...initialOrigins };
  const created: string[] = [];
  const reference = createSecretReferencer({
    values: async () => values,
    origins: async () => origins,
    create: async ({ name, value, boundOrigin }) => {
      created.push(name);
      values[name] = value;
      if (boundOrigin) origins[name] = boundOrigin;
    },
  });

  return { reference, values, origins, created };
}

describe("a credential typed into an HTTP node", () => {
  describe("when deciding whether a value is a literal", () => {
    it("treats blanks, references and a scheme in front of a reference as safe", () => {
      expect(holdsLiteralCredential("")).toBe(false);
      expect(holdsLiteralCredential("{{ secrets.PARTNER_TOKEN }}")).toBe(false);
      expect(holdsLiteralCredential("Bearer {{secrets.PARTNER_TOKEN}}")).toBe(false);
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
        origins: async () => ({}),
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

  describe("when the credential is saved for an address", () => {
    /** @scenario A credential typed into an HTTP agent is bound to the agent's address */
    it("binds the secret to the address and never reuses one bound elsewhere", async () => {
      const { reference, origins, created } = secretStore(
        { HTTP_API_AUTH_TOKEN: "mine" },
        { HTTP_API_AUTH_TOKEN: "https://other.example.com" },
      );
      const origin = "https://agent.example.com";

      const first = await reference({ owner: "api", field: "auth_token", value: "mine", origin });
      const again = await reference({ owner: "api", field: "auth_token", value: "mine", origin });

      expect(first).toBe("{{ secrets.HTTP_API_AUTH_TOKEN_2 }}");
      expect(again).toBe(first);
      expect(created).toEqual(["HTTP_API_AUTH_TOKEN_2"]);
      expect(origins.HTTP_API_AUTH_TOKEN_2).toBe(origin);
    });

    it("leaves a secret unbound when the address has no origin to bind to", async () => {
      const { reference, origins, created } = secretStore();

      await reference({ owner: "api", field: "auth_token", value: "mine" });

      expect(created).toEqual(["HTTP_API_AUTH_TOKEN"]);
      expect(origins).toEqual({});
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
