/**
 * Issue #6087 — authorization material must never leave the process in an
 * error, a log record, or a trace attribute.
 *
 * This is not theoretical. Object-store errors are quoted verbatim into our
 * own error messages, and Azure answers a failed request with a body that can
 * echo signed-request detail back. In bearer mode the Authorization header is
 * a live credential for the token's entire lifetime, so a single leaked error
 * string is a usable credential until it expires.
 *
 * Drives the real driver against a stubbed fetch that returns a hostile body,
 * rather than unit-testing the redactor alone — the defect this guards against
 * is "someone added an error path that forgot to redact", which only an
 * end-to-end assertion on the thrown message can catch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({ env: { S3_BUCKET_NAME: "" } }));

import { AzureBlobDriver } from "../azure-blob-driver";
import {
  redactAuthorizationMaterial,
  redactStorageErrorText,
} from "../project-storage-destination";

const ACCOUNT = "lwacct";
const CONTAINER = "stored-objects";
const KEY = Buffer.from("super-secret-account-key").toString("base64");
const URI = `azure-blob://${ACCOUNT}/${CONTAINER}/proj-1/abc123`;

/** A live JWT-shaped bearer token, the shape a real leak would take. */
const LEAKED_TOKEN =
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJodHRwczovL3N0b3JhZ2UifQ.c2lnbmF0dXJl";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubFetchReturning(body: string) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(body, {
        status: 403,
        statusText: "Server failed to authenticate",
      }),
  ) as unknown as typeof fetch;
}

function sharedKeyDriver() {
  return new AzureBlobDriver({
    mode: "sharedKey",
    accountName: ACCOUNT,
    accountKey: KEY,
  });
}

describe("redactAuthorizationMaterial()", () => {
  describe("given text containing a bearer token", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("removes the token while keeping the scheme readable", () => {
      const redacted = redactAuthorizationMaterial(
        `request failed: Authorization: Bearer ${LEAKED_TOKEN}`,
      );

      expect(redacted).not.toContain(LEAKED_TOKEN);
      expect(redacted).toContain("Bearer ***");
    });
  });

  describe("given text containing a shared-key signature", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("removes the account and signature pair", () => {
      const redacted = redactAuthorizationMaterial(
        `Authorization: SharedKey ${ACCOUNT}:aGVsbG8rc2lnbmF0dXJl=`,
      );

      expect(redacted).not.toContain("aGVsbG8rc2lnbmF0dXJl");
      expect(redacted).toContain("SharedKey ***");
    });
  });

  describe("given an Azure authentication-error body echoing signed detail", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("removes the echoed detail element", () => {
      const redacted = redactAuthorizationMaterial(
        "<Error><AuthenticationErrorDetail>The MAC signature computed from GET\\n\\nx-ms-date:...</AuthenticationErrorDetail></Error>",
      );

      expect(redacted).not.toContain("MAC signature computed");
      expect(redacted).toContain(
        "<AuthenticationErrorDetail>***</AuthenticationErrorDetail>",
      );
    });
  });

  describe("given a federated assertion in an exchange response", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("removes the assertion body", () => {
      const redacted = redactAuthorizationMaterial(
        "<client_assertion>eyJhbGciOiJSUzI1NiJ9.payload.sig</client_assertion>",
      );

      expect(redacted).not.toContain("eyJhbGciOiJSUzI1NiJ9");
    });
  });
});

describe("redactAuthorizationMaterial() against the wire formats the identity endpoint actually speaks", () => {
  /**
   * The token endpoint answers in JSON and accepts form-encoding. It never
   * speaks XML, so a redactor that only matched XML elements let every real
   * token-endpoint leak straight through.
   */
  describe("given a JSON token response", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("removes the access token from the JSON field", () => {
      const redacted = redactAuthorizationMaterial(
        `{"token_type":"Bearer","expires_in":3599,"access_token":"${LEAKED_TOKEN}"}`,
      );

      expect(redacted).not.toContain(LEAKED_TOKEN);
    });
  });

  describe("given a JSON token response that a log pipeline will re-parse", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("leaves the JSON valid after redacting, not just token-free", () => {
      const redacted = redactAuthorizationMaterial(
        `{"token_type":"Bearer","expires_in":3599,"access_token":"${LEAKED_TOKEN}"}`,
      );

      expect(redacted).not.toContain(LEAKED_TOKEN);
      // Redacting by eating the key's closing quote hides the token and
      // corrupts the record — anything downstream that parses the log then
      // fails on a line that looks fine to a human.
      expect(() => JSON.parse(redacted)).not.toThrow();
      expect(JSON.parse(redacted).access_token).toBe("***");
    });
  });

  describe("given a form-encoded exchange request echoed back", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("removes the client assertion", () => {
      const redacted = redactAuthorizationMaterial(
        `grant_type=client_credentials&client_assertion=${LEAKED_TOKEN}&scope=x`,
      );

      expect(redacted).not.toContain(LEAKED_TOKEN);
    });
  });

  describe("given an XML error element carrying attributes", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("still removes the echoed detail", () => {
      const redacted = redactAuthorizationMaterial(
        '<AuthenticationErrorDetail xml:space="preserve">MAC signature over GET</AuthenticationErrorDetail>',
      );

      expect(redacted).not.toContain("MAC signature over GET");
    });
  });

  describe("given ordinary prose that merely mentions a scheme", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("leaves the sentence readable rather than eating the next word", () => {
      const redacted = redactAuthorizationMaterial(
        "SharedKey authentication is disabled on this storage account.",
      );

      expect(redacted).toContain("SharedKey authentication is disabled");
    });
  });
});

describe("redactStorageErrorText()", () => {
  describe("given text carrying both a tenant URI and a credential", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("redacts both in one pass so callers cannot apply only half", () => {
      const redacted = redactStorageErrorText(
        `failed on ${URI} with Bearer ${LEAKED_TOKEN}`,
      );

      expect(redacted).not.toContain(LEAKED_TOKEN);
      // The account and container are tenant-identifying and already redacted.
      expect(redacted).not.toContain(`${ACCOUNT}/${CONTAINER}`);
    });
  });
});

describe("AzureBlobDriver error paths", () => {
  describe("given Azure rejects a PUT with a body echoing authorization detail", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("throws without the signature, the account key, or the storage account name", async () => {
      stubFetchReturning(
        `<?xml version="1.0"?><Error><Code>AuthenticationFailed</Code>` +
          `<AuthenticationErrorDetail>signature over PUT for ${URI}</AuthenticationErrorDetail>` +
          `<Echo>Authorization: SharedKey ${ACCOUNT}:c2lnbmF0dXJlLWhlcmU=</Echo></Error>`,
      );

      const error = await sharedKeyDriver()
        .put(URI, Buffer.from("payload"), "text/plain")
        .then(
          () => null,
          (e: unknown) => e as Error,
        );

      expect(error).toBeInstanceOf(Error);
      const message = String(error?.message);
      expect(message).not.toContain("c2lnbmF0dXJlLWhlcmU");
      expect(message).not.toContain(KEY);
      // The name promises the account name is gone too — assert it rather
      // than leaving that third of the claim untested.
      expect(message).not.toContain(ACCOUNT);
      expect(message).not.toContain("signature over PUT");
      // Still useful to an operator: the failure and its status survive.
      expect(message).toContain("403");
    });
  });
});
