// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Which key the save-time account lookup reads, and which request it makes.
 *
 * The lookup is the one place in the connection-identity path that opens a
 * customer credential, and until now nothing pinned WHICH field it opens. The
 * composer writes the administrator key to `credentials.token`
 * (`buildAnthropicAdminPullConfig` / `buildOpenAiAdminPullConfig`) and both
 * pullers read it back from `credentials.token`, so the lookup reading anything
 * else would refuse every fresh save with "no administrator key on this
 * connection" before a single provider request left the process — a whole
 * source type broken, with a message pointing at the admin rather than at us.
 *
 * Nothing here reaches a provider: the fetch helper is a stand-in, which is
 * also what lets the request itself be asserted. The point of these cases is
 * the credential contract between the form, this lookup and the puller — three
 * modules that must agree on one field name and have no compiler tying them
 * together.
 */

import { describe, expect, it, vi } from "vitest";

const { fetchStub } = vi.hoisted(() => ({ fetchStub: vi.fn() }));

vi.mock("~/utils/ssrfProtection", () => ({ ssrfSafeFetch: fetchStub }));

// A reversible stand-in for the shared AES helper, so the sealed-envelope case
// below can be built here without an app key. The real crypto is covered by
// `ingestionCredentials.unit.test.ts`.
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `cipher(${text})`,
  decrypt: (blob: string) => blob.slice("cipher(".length, -1),
}));

import { encryptParserConfigCredentials } from "../ingestionCredentials";
import { lookUpProviderAccount } from "../providerAccountLookup";

/** An obviously fake administrator key. */
const ADMIN_KEY = "sk-ant-admin-EXAMPLEKEY-00000000";

const providerResponding = (init: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => init.json,
  headers: {
    get: (name: string) => init.headers?.[name.toLowerCase()] ?? null,
  },
  body: { cancel: async () => undefined },
});

const requestHeaders = () =>
  (fetchStub.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;

describe("given a connection saved through the composer, which writes the administrator key to credentials.token", () => {
  describe("when the Anthropic account is looked up", () => {
    it("sends that key and answers with the organisation the provider named", async () => {
      fetchStub.mockReset();
      fetchStub.mockResolvedValue(
        providerResponding({ json: { id: "org_example_0001" } }),
      );

      const account = await lookUpProviderAccount({
        sourceType: "anthropic_admin",
        parserConfig: { report: "cost", credentials: { token: ADMIN_KEY } },
      });

      expect(account).toBe("org_example_0001");
      expect(requestHeaders()["x-api-key"]).toBe(ADMIN_KEY);
    });
  });

  describe("when the OpenAI account is looked up", () => {
    it("sends that key as a bearer and takes the account off the response header", async () => {
      fetchStub.mockReset();
      fetchStub.mockResolvedValue(
        providerResponding({
          headers: { "openai-organization": "org-example" },
        }),
      );

      const account = await lookUpProviderAccount({
        sourceType: "openai_admin",
        parserConfig: { report: "cost", credentials: { token: ADMIN_KEY } },
      });

      expect(account).toBe("org-example");
      expect(requestHeaders().Authorization).toBe(`Bearer ${ADMIN_KEY}`);
    });
  });
});

describe("given an edit that did not resend the secret, so the stored envelope was carried across", () => {
  describe("when the account is looked up", () => {
    it("opens the envelope and sends the same key", async () => {
      fetchStub.mockReset();
      fetchStub.mockResolvedValue(
        providerResponding({ json: { id: "org_example_0001" } }),
      );
      const sealed = encryptParserConfigCredentials({
        report: "cost",
        credentials: { token: ADMIN_KEY },
      })!;
      expect(typeof sealed.credentials).toBe("string");

      await lookUpProviderAccount({
        sourceType: "anthropic_admin",
        parserConfig: sealed,
      });

      expect(requestHeaders()["x-api-key"]).toBe(ADMIN_KEY);
    });
  });
});

describe("given a connection carrying no administrator key", () => {
  describe("when the account is looked up", () => {
    it("refuses before anything is sent to the provider", async () => {
      fetchStub.mockReset();

      await expect(
        lookUpProviderAccount({
          sourceType: "anthropic_admin",
          parserConfig: { report: "cost", credentials: {} },
        }),
      ).rejects.toThrow(/no administrator key/);
      expect(fetchStub).not.toHaveBeenCalled();
    });
  });
});
