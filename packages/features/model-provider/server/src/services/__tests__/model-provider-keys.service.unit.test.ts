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
 * The customKeys counterpart of the header merge above — same
 * placeholder-restoration contract, applied to the provider's credential
 * record rather than its extra headers.
 *
 * PORTED FROM
 * `platform/app/src/server/modelProviders/__tests__/modelProvider.service.unit.test.ts`,
 * whose subject (a standalone `mergeStoredCustomKeys` function) is now this
 * class's `merge` method.
 */
describe("ModelProviderKeysService merge", () => {
  describe("given a row with nothing worth keeping", () => {
    it("drops visible configuration when the write carries no credentials", () => {
      // A base URL is shown back, so a write that omits it is stating the
      // configuration in full and the stored value goes.
      expect(
        policy.merge({
          incoming: null,
          stored: { OPENAI_BASE_URL: "https://old-url.com" },
        }),
      ).toEqual({});
    });

    it("keeps a stored secret the write never names", () => {
      // The other half of the same rule. A secret is masked on read, so no
      // caller can resend one it did not type, and omitting it cannot mean
      // "delete it".
      expect(
        policy.merge({
          incoming: null,
          stored: { CODEX_ACCESS_TOKEN: "stored-token" },
        }),
      ).toEqual({ CODEX_ACCESS_TOKEN: "stored-token" });
    });

    it("returns the write untouched when the row is empty", () => {
      expect(
        policy.merge({
          incoming: { OPENAI_API_KEY: "new-key" },
          stored: null,
        }),
      ).toEqual({ OPENAI_API_KEY: "new-key" });
    });

    it("drops a masked field with nothing behind it", () => {
      expect(
        policy.merge({
          incoming: {
            OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
            OPENAI_BASE_URL: "https://new-url.com",
          },
          stored: null,
        }),
      ).toEqual({ OPENAI_BASE_URL: "https://new-url.com" });
    });

    it("drops a masked field the stored row does not have", () => {
      expect(
        policy.merge({
          incoming: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER },
          stored: { OPENAI_BASE_URL: "https://old-url.com" },
        }),
      ).toEqual({});
    });
  });

  describe("when a field comes back masked", () => {
    it("restores the stored value and takes the edited one", () => {
      const result = policy.merge({
        incoming: {
          OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
          OPENAI_BASE_URL: "https://new-url.com",
        },
        stored: {
          OPENAI_API_KEY: "sk-actual-secret",
          OPENAI_BASE_URL: "https://old-url.com",
        },
      });

      expect(result.OPENAI_API_KEY).toBe("sk-actual-secret");
      expect(result.OPENAI_BASE_URL).toBe("https://new-url.com");
    });

    /** @scenario Preserve original subscription key when saving with masked placeholder */
    it("restores every masked field at once", () => {
      const result = policy.merge({
        incoming: {
          AWS_ACCESS_KEY_ID: MASKED_KEY_PLACEHOLDER,
          AWS_SECRET_ACCESS_KEY: MASKED_KEY_PLACEHOLDER,
          AWS_REGION_NAME: "eu-west-1",
        },
        stored: {
          AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
          AWS_SECRET_ACCESS_KEY: "secretkey123",
          AWS_REGION_NAME: "us-east-1",
        },
      });

      expect(result.AWS_ACCESS_KEY_ID).toBe("AKIAEXAMPLE");
      expect(result.AWS_SECRET_ACCESS_KEY).toBe("secretkey123");
      expect(result.AWS_REGION_NAME).toBe("eu-west-1");
    });

    it("carries along a field the row never held", () => {
      const result = policy.merge({
        incoming: {
          OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
          NEW_KEY: "new-value",
        },
        stored: { OPENAI_API_KEY: "sk-stored" },
      });

      expect(result.OPENAI_API_KEY).toBe("sk-stored");
      expect(result.NEW_KEY).toBe("new-value");
    });
  });

  describe("when a field is named with a value", () => {
    it("takes the new value over the stored one", () => {
      expect(
        policy.merge({
          incoming: { OPENAI_API_KEY: "sk-new-key" },
          stored: { OPENAI_API_KEY: "sk-old-key" },
        }).OPENAI_API_KEY,
      ).toBe("sk-new-key");
    });

    it("clears the stored secret when the value is empty", () => {
      expect(
        policy.merge({
          incoming: { OPENAI_API_KEY: "" },
          stored: { OPENAI_API_KEY: "sk-old-key" },
        }).OPENAI_API_KEY,
      ).toBe("");
    });
  });

  // Secrets are masked on read, so no caller can resend one it did not type,
  // and leaving one out cannot mean "delete it". Everything else is visible,
  // so a write states it in full.
  describe("when a field is left out of the write", () => {
    /** @scenario A save that names one credential keeps the ones it leaves out */
    it("keeps a stored secret", () => {
      const result = policy.merge({
        incoming: { AZURE_OPENAI_ENDPOINT: "https://acme2.openai.azure.com" },
        stored: {
          AZURE_OPENAI_API_KEY: "sk-stored",
          AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
        },
      });

      expect(result).toEqual({
        AZURE_OPENAI_API_KEY: "sk-stored",
        AZURE_OPENAI_ENDPOINT: "https://acme2.openai.azure.com",
      });
    });

    it("does not resurrect a secret the customer had already cleared", () => {
      const result = policy.merge({
        incoming: { AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com" },
        stored: { AZURE_OPENAI_API_KEY: "" },
      });

      expect(result).toEqual({
        AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
      });
    });

    /** @scenario Switching Azure to its API gateway keeps the key and drops the direct endpoint */
    it("drops a stored field that is not a secret", () => {
      const result = policy.merge({
        incoming: {
          AZURE_API_GATEWAY_BASE_URL: "https://apim.acme.com",
          AZURE_API_GATEWAY_VERSION: "2024-05-01-preview",
        },
        stored: {
          AZURE_OPENAI_API_KEY: "sk-stored",
          AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
        },
      });

      expect(result).toEqual({
        AZURE_API_GATEWAY_BASE_URL: "https://apim.acme.com",
        AZURE_API_GATEWAY_VERSION: "2024-05-01-preview",
        AZURE_OPENAI_API_KEY: "sk-stored",
      });
    });
  });
});

/** @scenario API key masking when editing existing provider */
describe("ModelProviderKeysService maskApiKeys", () => {
  it("masks the API key and leaves the base URL visible", () => {
    const result = policy.tryMask({
      OPENAI_API_KEY: "sk-actual-key",
      OPENAI_BASE_URL: "https://api.openai.com",
    });

    expect(result?.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
    expect(result?.OPENAI_BASE_URL).toBe("https://api.openai.com");
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
