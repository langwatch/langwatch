import { describe, expect, it } from "vitest";

import {
  AzureBackendMisconfiguredError,
  AzureBlobCredentialsService,
} from "../azure-blob-credentials.service.ts";

const guards = AzureBlobCredentialsService.create();

describe("AzureBlobCredentialsService transport guards, as a migration run shares them", () => {
  describe("given a token-mode endpoint over plaintext", () => {
    it("refuses it, naming the endpoint variable, unless the test escape hatch is set", () => {
      const plaintext = {
        endpointBaseUrl: "http://storage.example.com/lwacct",
        authorityHost: undefined,
      };

      expect(() => guards.assertTokenModeTransportSafety(plaintext)).toThrow(
        AzureBackendMisconfiguredError,
      );
      expect(() => guards.assertTokenModeTransportSafety(plaintext)).toThrow(/AZURE_BLOB_ENDPOINT/);
      expect(() =>
        guards.assertTokenModeTransportSafety({
          endpointBaseUrl: "http://127.0.0.1:10000/devstoreaccount1",
          authorityHost: undefined,
          allowInsecureTokenEndpointForTests: true,
        }),
      ).not.toThrow();
    });
  });

  describe("given a sovereign-cloud endpoint", () => {
    it("refuses it without an authority host and accepts it with one", () => {
      const endpointBaseUrl = "https://lwacct.blob.core.usgovcloudapi.net";

      expect(() =>
        guards.assertTokenModeTransportSafety({ endpointBaseUrl, authorityHost: undefined }),
      ).toThrow(/AZURE_BLOB_AUTHORITY_HOST/);
      expect(() =>
        guards.assertTokenModeTransportSafety({
          endpointBaseUrl,
          authorityHost: "https://login.microsoftonline.us",
        }),
      ).not.toThrow();
    });
  });
});
