/**
 * The credential-requiredness rule the model-provider drawer renders from,
 * tested against the REAL registry schemas (no registry mock, unlike the
 * sibling modelProviderHelpers.unit.test.ts) — the whole point of deriving
 * requiredness from the schema is that the two cannot drift apart, so a
 * test that invents its own schemas would prove nothing about the drawer.
 *
 * Covers @integration scenarios from
 * specs/model-providers/provider-configuration.feature.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { modelProviders } from "@langwatch/model-provider-contract";
import {
  getDisplayKeysForProvider,
  getEmptyRequiredCredentialKeys,
  getRequiredCredentialKeys,
  getSchemaShape,
} from "../modelProviderHelpers";

/** The exact inputs the drawer feeds the rule for a given provider. */
function requiredKeysFor(
  providerKey: keyof typeof modelProviders,
  values: Record<string, string>,
): string[] {
  const definition = modelProviders[providerKey] as {
    keysSchema: unknown;
    optionalKeys?: readonly string[];
  };
  return [
    ...getRequiredCredentialKeys({
      keysSchema: definition.keysSchema,
      fieldSchemas: getDisplayKeysForProvider(
        providerKey,
        false,
        getSchemaShape(definition.keysSchema),
      ),
      values,
      optionalKeys: definition.optionalKeys,
    }),
  ].sort();
}

/**
 * Every provider whose schema accepts one credential in place of another.
 * Kept as a table rather than a list of openai tests: the rule is meant to
 * hold for the shape, not for a provider, and a fourth provider adopting it
 * joins here by adding a row.
 */
const eitherOrProviders = [
  {
    providerKey: "openai" as const,
    apiKey: "OPENAI_API_KEY",
    baseUrl: "OPENAI_BASE_URL",
  },
  {
    providerKey: "anthropic" as const,
    apiKey: "ANTHROPIC_API_KEY",
    baseUrl: "ANTHROPIC_BASE_URL",
  },
];

describe("getRequiredCredentialKeys()", () => {
  describe.each(eitherOrProviders)(
    "given $providerKey, which accepts an API key or a base URL",
    ({ providerKey, apiKey, baseUrl }) => {
      describe("when no base URL is entered", () => {
        /** @scenario The API key stops being required once a base URL is entered */
        it("requires the API key", () => {
          expect(requiredKeysFor(providerKey, { [apiKey]: "", [baseUrl]: "" })).toEqual([
            apiKey,
          ]);
        });
      });

      describe("when a base URL is entered", () => {
        /** @scenario The API key stops being required once a base URL is entered */
        it("requires nothing further", () => {
          expect(
            requiredKeysFor(providerKey, {
              [apiKey]: "",
              [baseUrl]: "https://llm.acme.internal/v1",
            }),
          ).toEqual([]);
        });
      });

      describe("when the base URL is cleared again", () => {
        /** @scenario The API key stops being required once a base URL is entered */
        it("requires the API key again", () => {
          expect(requiredKeysFor(providerKey, { [apiKey]: "", [baseUrl]: "" })).toEqual([
            apiKey,
          ]);
        });
      });

      describe("when the base URL holds only whitespace", () => {
        /** @scenario The API key stops being required once a base URL is entered */
        it("treats it as blank and requires the API key", () => {
          expect(
            requiredKeysFor(providerKey, { [apiKey]: "", [baseUrl]: "   " }),
          ).toEqual([apiKey]);
        });
      });

      describe("when a key is entered and no base URL", () => {
        it("never marks the base URL required", () => {
          expect(
            requiredKeysFor(providerKey, {
              [apiKey]: "sk-acme",
              [baseUrl]: "",
            }),
          ).toEqual([apiKey]);
        });
      });
    },
  );

  describe("given a provider with a single credential and no alternative", () => {
    /** @scenario A provider with a single credential keeps its required marker */
    it("requires the API key whatever else is entered", () => {
      expect(requiredKeysFor("gemini", { GEMINI_API_KEY: "" })).toEqual([
        "GEMINI_API_KEY",
      ]);
      expect(requiredKeysFor("gemini", { GEMINI_API_KEY: "abc" })).toEqual([
        "GEMINI_API_KEY",
      ]);
    });
  });

  describe("given a schema left permissive so a key can arrive from the environment", () => {
    /**
     * Azure's fields are all `.nullable().optional()` for storage reasons;
     * that says nothing about what a customer must type. Reading the schema
     * literally here would drop every required marker on the Azure form.
     */
    it("keeps the declared credentials required and the version overrides optional", () => {
      expect(
        requiredKeysFor("azure", {
          AZURE_OPENAI_API_KEY: "",
          AZURE_OPENAI_ENDPOINT: "",
          AZURE_OPENAI_API_VERSION: "",
        }),
      ).toEqual(["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"]);
    });

    it("keeps every AWS credential required for bedrock", () => {
      expect(
        requiredKeysFor("bedrock", {
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
          AWS_REGION_NAME: "",
        }),
      ).toEqual(["AWS_ACCESS_KEY_ID", "AWS_REGION_NAME", "AWS_SECRET_ACCESS_KEY"]);
    });
  });

  describe("given the custom provider", () => {
    it("requires the endpoint and leaves the key optional", () => {
      expect(
        requiredKeysFor("custom", {
          CUSTOM_API_KEY: "",
          CUSTOM_BASE_URL: "",
        }),
      ).toEqual(["CUSTOM_BASE_URL"]);
    });
  });

  describe("given a provider that adopts the either/or shape later", () => {
    const eitherOrSchema = z
      .object({
        ACME_API_KEY: z.string().nullable().optional(),
        ACME_BASE_URL: z.string().nullable().optional(),
      })
      .superRefine((data, ctx) => {
        if (!data.ACME_API_KEY?.trim() && !data.ACME_BASE_URL?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Add an API key, or a base URL.",
          });
        }
      });

    const requiredFor = (values: Record<string, string>) =>
      [
        ...getRequiredCredentialKeys({
          keysSchema: eitherOrSchema,
          fieldSchemas: getSchemaShape(eitherOrSchema),
          values,
          optionalKeys: ["ACME_BASE_URL"],
        }),
      ].sort();

    /** @scenario The API key stops being required once a base URL is entered */
    it("inherits the behaviour with nothing declared beyond the optional base URL", () => {
      expect(requiredFor({ ACME_API_KEY: "", ACME_BASE_URL: "" })).toEqual([
        "ACME_API_KEY",
      ]);
      expect(
        requiredFor({
          ACME_API_KEY: "",
          ACME_BASE_URL: "https://llm.acme.internal",
        }),
      ).toEqual([]);
    });
  });

  describe("given one field is filled in with something the schema rejects", () => {
    const schema = z.object({
      ACME_API_KEY: z.string().min(1),
      ACME_ENDPOINT: z.string().url(),
      ACME_LABEL: z.string().nullable().optional(),
    });

    it("does not make the untouched optional field look required", () => {
      const required = [
        ...getRequiredCredentialKeys({
          keysSchema: schema,
          fieldSchemas: getSchemaShape(schema),
          values: {
            ACME_API_KEY: "sk-acme",
            ACME_ENDPOINT: "not-a-url",
            ACME_LABEL: "",
          },
          optionalKeys: undefined,
        }),
      ].sort();
      expect(required).toEqual(["ACME_API_KEY", "ACME_ENDPOINT"]);
    });
  });

  describe("given a provider with no schema at all", () => {
    it("marks nothing required rather than throwing", () => {
      expect(
        getRequiredCredentialKeys({
          keysSchema: undefined,
          fieldSchemas: {},
          values: {},
          optionalKeys: undefined,
        }).size,
      ).toBe(0);
    });
  });
});

describe("getEmptyRequiredCredentialKeys()", () => {
  it("lists the required fields still blank, in required order", () => {
    expect(
      getEmptyRequiredCredentialKeys({
        requiredKeys: new Set(["ACME_API_KEY", "ACME_ENDPOINT"]),
        values: { ACME_API_KEY: "  ", ACME_ENDPOINT: "https://acme.test" },
      }),
    ).toEqual(["ACME_API_KEY"]);
  });
});
