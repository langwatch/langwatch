import { MASKED_KEY_PLACEHOLDER } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";
import { ModelProviderKeysService } from "../model-provider-keys.service";

const policy = ModelProviderKeysService.create();
const stored = [
  { key: "Authorization", value: "Bearer real-secret-abc" },
  { key: "X-Tenant", value: "tenant-42" },
];

describe("ModelProviderKeysService", () => {
  it("restores masked header values by key", () => {
    expect(
      policy.mergeHeaders({
        stored,
        incoming: stored.map(({ key }) => ({ key, value: MASKED_KEY_PLACEHOLDER })),
      }),
    ).toEqual(stored);
  });

  it("uses an unclaimed positional value when a header is renamed", () => {
    expect(
      policy.mergeHeaders({
        stored,
        incoming: [
          { key: "X-Auth", value: MASKED_KEY_PLACEHOLDER },
          { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
        ],
      }),
    ).toEqual([
      { key: "X-Auth", value: "Bearer real-secret-abc" },
      { key: "X-Tenant", value: "tenant-42" },
    ]);
  });

  it("does not assign a claimed secret to a new header after reordering", () => {
    expect(
      policy.mergeHeaders({
        stored,
        incoming: [
          { key: "X-New", value: MASKED_KEY_PLACEHOLDER },
          { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
        ],
      }),
    ).toEqual([{ key: "Authorization", value: "Bearer real-secret-abc" }]);
  });

  it("drops unmatched placeholders and retains explicit values", () => {
    expect(
      policy.mergeHeaders({
        stored,
        incoming: [
          { key: "Authorization", value: "Bearer replacement" },
          { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
          { key: "X-Never-Stored", value: MASKED_KEY_PLACEHOLDER },
        ],
      }),
    ).toEqual([
      { key: "Authorization", value: "Bearer replacement" },
      { key: "X-Tenant", value: "tenant-42" },
    ]);
  });

  it("does not persist a masked value on a new row", () => {
    expect(
      policy.mergeHeaders({
        stored: [],
        incoming: [
          { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
          { key: "X-Real", value: "real-value" },
        ],
      }),
    ).toEqual([{ key: "X-Real", value: "real-value" }]);
  });
});

/**
 * The read side of the same policy. Every tRPC and REST response carrying a
 * provider row goes through `tryMask` and `maskHeaders` first, so this is the
 * guarantee that a stored credential never reaches a browser. Moved here with
 * the Model Provider tRPC vertical: the masking is the service's, not the
 * transport's, and the transport's own pass-through is pinned separately in
 * `model-provider-trpc-api.unit.test.ts`.
 */
describe("ModelProviderKeysService read masking", () => {
  const storedCredentials: Record<string, Record<string, string>> = {
    openai: {
      OPENAI_API_KEY: "sk-plaintext-secret-123",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
    },
    bedrock: {
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "aws-secret-access-key-456",
      AWS_REGION_NAME: "us-east-1",
    },
    azure: {
      AZURE_OPENAI_API_KEY: "azure-subscription-key-789",
      AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
    },
    custom: {
      CUSTOM_API_KEY: "custom-plaintext-key",
      CUSTOM_BASE_URL: "https://llm.internal.example.com/v1",
    },
  };

  describe("when a stored credential set is read back", () => {
    it("replaces every secret field with the placeholder", () => {
      const masked = Object.values(storedCredentials).map((keys) => policy.tryMask(keys));

      expect(masked).toEqual([
        {
          OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
          OPENAI_BASE_URL: "https://api.openai.com/v1",
        },
        {
          AWS_ACCESS_KEY_ID: MASKED_KEY_PLACEHOLDER,
          AWS_SECRET_ACCESS_KEY: MASKED_KEY_PLACEHOLDER,
          AWS_REGION_NAME: "us-east-1",
        },
        {
          AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
          AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
        },
        {
          CUSTOM_API_KEY: MASKED_KEY_PLACEHOLDER,
          CUSTOM_BASE_URL: "https://llm.internal.example.com/v1",
        },
      ]);
    });

    it("leaves no plaintext secret anywhere in the masked output", () => {
      const serialized = JSON.stringify(
        Object.values(storedCredentials).map((keys) => policy.tryMask(keys)),
      );

      for (const secret of [
        "sk-plaintext-secret-123",
        "aws-secret-access-key-456",
        "azure-subscription-key-789",
        "custom-plaintext-key",
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });

    it("answers null for a row that stores no credentials rather than an empty set", () => {
      expect(policy.tryMask(null)).toBeNull();
    });
  });

  describe("when extra headers are read back", () => {
    it("keeps every header name and drops every value", () => {
      expect(
        policy.maskHeaders([
          { key: "Authorization", value: "Bearer header-bearer-secret-012" },
          { key: "X-Tenant", value: "tenant-42" },
        ]),
      ).toEqual([
        { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
        // Masked too: a header this side cannot classify is treated as secret.
        { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
      ]);
    });
  });
});
