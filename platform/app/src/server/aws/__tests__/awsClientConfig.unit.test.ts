import { describe, expect, it } from "vitest";
import {
  buildAwsClientConfig,
  staticCredentialsOrUndefined,
} from "../awsClientConfig";

/**
 * The invariant these tests exist for broke IRSA in production once: a
 * `credentials` object built from unset environment variables reaches the SDK
 * as `{accessKeyId: "", secretAccessKey: ""}`, which the SDK treats as a real
 * answer and stops looking with. The pod had a role, and we told it we had
 * keys.
 */
describe("buildAwsClientConfig", () => {
  describe("given an incomplete credential pair", () => {
    it("omits credentials entirely rather than sending empty strings", () => {
      for (const credentials of [
        { accessKeyId: "", secretAccessKey: "" },
        { accessKeyId: "AKIA1", secretAccessKey: "" },
        { accessKeyId: "", secretAccessKey: "s3cr3t" },
        { accessKeyId: "   ", secretAccessKey: "s3cr3t" },
        { accessKeyId: undefined, secretAccessKey: undefined },
        { accessKeyId: null, secretAccessKey: null },
      ]) {
        expect(staticCredentialsOrUndefined(credentials)).toBeUndefined();
        const config = buildAwsClientConfig({
          region: "eu-central-1",
          targetHost: "sqs.eu-central-1.amazonaws.com",
          staticCredentials: credentials,
        });
        // Absent, not present-and-empty. `in` rather than a truthiness check:
        // an empty object under the key is exactly the failure mode.
        expect("credentials" in config).toBe(false);
      }
    });

    it("passes a complete pair through, trimmed", () => {
      const config = buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "sqs.eu-central-1.amazonaws.com",
        staticCredentials: {
          accessKeyId: " AKIA1 ",
          secretAccessKey: " s3cr3t ",
        },
      });
      expect(config.credentials).toEqual({
        accessKeyId: "AKIA1",
        secretAccessKey: "s3cr3t",
      });
    });

    it("carries a session token only when there is one", () => {
      expect(
        staticCredentialsOrUndefined({
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
          sessionToken: "",
        }),
      ).toEqual({ accessKeyId: "AKIA1", secretAccessKey: "s3cr3t" });
      expect(
        staticCredentialsOrUndefined({
          accessKeyId: "AKIA1",
          secretAccessKey: "s3cr3t",
          sessionToken: "tok",
        }),
      ).toMatchObject({ sessionToken: "tok" });
    });
  });

  describe("when a caller sits behind its own retry ladder", () => {
    it("turns the SDK's retries off only when asked", () => {
      const laddered = buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "sqs.eu-central-1.amazonaws.com",
        disableSdkRetries: true,
      });
      expect(laddered.maxAttempts).toBe(1);

      const plain = buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "email.eu-central-1.amazonaws.com",
      });
      // Absent, so the SDK's own default stands: a caller with no ladder above
      // it would lose transient failures otherwise.
      expect("maxAttempts" in plain).toBe(false);
    });
  });

  describe("when no region is given", () => {
    it("leaves the field out so the SDK resolves it", () => {
      const config = buildAwsClientConfig({
        targetHost: "email.eu-central-1.amazonaws.com",
      });
      expect("region" in config).toBe(false);
    });
  });

  describe("when a role is assumed", () => {
    it("supplies a credential provider rather than a static pair", () => {
      const config = buildAwsClientConfig({
        region: "eu-central-1",
        targetHost: "sqs.eu-central-1.amazonaws.com",
        assumeRole: {
          roleArn: "arn:aws:iam::123456789012:role/langwatch",
          externalId: "lw-abc",
        },
      });
      expect(typeof config.credentials).toBe("function");
    });
  });
});
