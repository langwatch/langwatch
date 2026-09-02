/** Proves the real Azure error path applies the contract-owned redaction. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { AzureBlobStoredObjectDriver } from "../azure-blob.stored-object-driver.adapter";

const ACCOUNT = "lwacct";
const CONTAINER = "stored-objects";
const KEY = Buffer.from("super-secret-account-key").toString("base64");
const URI = `azure-blob://${ACCOUNT}/${CONTAINER}/proj-1/abc123`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetchReturning(body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body, {
          status: 403,
          statusText: "Server failed to authenticate",
        }),
    ),
  );
}

function sharedKeyDriver() {
  return AzureBlobStoredObjectDriver.create({
    mode: "sharedKey",
    accountName: ACCOUNT,
    accountKey: KEY,
  });
}

describe("AzureBlobStoredObjectDriver error paths", () => {
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
