import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();
vi.mock("@aws-sdk/client-secrets-manager", () => {
  return {
    SecretsManagerClient: class {
      send = mockSend;
    },
    GetSecretValueCommand: class {
      SecretId: string;
      constructor(input: { SecretId: string }) {
        this.SecretId = input.SecretId;
      }
    },
  };
});

import { AwsSecretsProvider } from "../aws-secrets-provider";

describe("AwsSecretsProvider", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("returns secret string", async () => {
    mockSend.mockResolvedValue({ SecretString: '{"DB":"url"}' });
    const provider = new AwsSecretsProvider();
    expect(await provider.get("langwatch/dev/app")).toBe('{"DB":"url"}');
  });

  it("passes the secret ID to GetSecretValueCommand", async () => {
    mockSend.mockResolvedValue({ SecretString: "{}" });
    const provider = new AwsSecretsProvider();
    await provider.get("langwatch/dev/app");
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ SecretId: "langwatch/dev/app" }),
      expect.anything()
    );
  });

  describe("when secret has no string value", () => {
    it("throws", async () => {
      mockSend.mockResolvedValue({ SecretString: undefined });
      const provider = new AwsSecretsProvider();
      await expect(provider.get("langwatch/dev/app")).rejects.toThrow(
        "has no string value"
      );
    });
  });

  describe("when request times out", () => {
    it("wraps error with SSO hint", async () => {
      const err = new Error("timeout");
      err.name = "TimeoutError";
      mockSend.mockRejectedValue(err);
      const provider = new AwsSecretsProvider();
      await expect(provider.get("x")).rejects.toThrow("aws sso login");
    });
  });

  describe("when abort signal fires", () => {
    it("wraps error with SSO hint", async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      mockSend.mockRejectedValue(err);
      const provider = new AwsSecretsProvider();
      await expect(provider.get("x")).rejects.toThrow("aws sso login");
    });
  });

  describe("when credentials are missing", () => {
    it("wraps error with SSO hint", async () => {
      const err = new Error("no creds");
      err.name = "CredentialsProviderError";
      mockSend.mockRejectedValue(err);
      const provider = new AwsSecretsProvider();
      await expect(provider.get("x")).rejects.toThrow("aws sso login");
    });
  });

  describe("when an unknown error occurs", () => {
    it("rethrows the original error", async () => {
      const err = new Error("something else");
      err.name = "SomeOtherError";
      mockSend.mockRejectedValue(err);
      const provider = new AwsSecretsProvider();
      await expect(provider.get("x")).rejects.toThrow("something else");
    });
  });
});
