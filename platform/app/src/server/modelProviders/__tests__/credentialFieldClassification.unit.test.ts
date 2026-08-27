import { describe, expect, it } from "vitest";
import {
  PUBLIC_CREDENTIAL_FIELDS,
  SECRET_CREDENTIAL_MARKERS,
} from "../../../utils/constants";
import {
  getSchemaShape,
  isSecretCredentialField,
} from "../../../utils/modelProviderHelpers";
import { modelProviders } from "@langwatch/model-provider-contract";

/**
 * The classifier decides what every read path masks and what a partial write
 * keeps. It is name-based and global, so the provider registry can move
 * underneath it: a provider that adds a credential field, or renames one,
 * changes what the classifier is asked about without touching this file.
 *
 * These tests are the link between the two. They walk the registry rather
 * than restating it, so a new provider is covered on the day it lands.
 */

/** Every credential field name any provider can store, from the registry. */
function everyRegistryCredentialField(): { provider: string; field: string }[] {
  return Object.entries(modelProviders).flatMap(([provider, definition]) =>
    Object.keys(getSchemaShape(definition.keysSchema)).map((field) => ({
      provider,
      field,
    })),
  );
}

describe("credential field classification", () => {
  describe("given the provider registry is walked for credential fields", () => {
    it("reads a field name from every provider", () => {
      // Guards the walk itself: `getSchemaShape` returns {} for a wrapper it
      // cannot unwrap, which would make every assertion below vacuous.
      for (const [provider, definition] of Object.entries(modelProviders)) {
        const fields = Object.keys(getSchemaShape(definition.keysSchema));
        expect(fields.length, `${provider} yielded no credential fields`).toBeGreaterThan(
          0,
        );
      }
    });

    it("classifies every field a provider can store", () => {
      // A field is either named in the public list or masked. Nothing is
      // classified by accident, and a field the list forgets fails closed.
      for (const { provider, field } of everyRegistryCredentialField()) {
        const isPublic = PUBLIC_CREDENTIAL_FIELDS.has(field);
        expect(
          isSecretCredentialField(field),
          `${provider}.${field} classification`,
        ).toBe(!isPublic);
      }
    });
  });

  describe("when a field is not named in the public list", () => {
    /** @scenario Credential fields are secret unless the registry declares them public */
    it("treats it as a secret", () => {
      expect(isSecretCredentialField("SOME_PROVIDER_NEW_CREDENTIAL")).toBe(true);
      expect(isSecretCredentialField("")).toBe(true);
    });
  });

  describe("given a provider authenticates with an OAuth device flow", () => {
    it("classifies its whole token set as secret", () => {
      // The provider that made the earlier name-pattern rule fail: an OAuth
      // token set whose fields are called tokens, not keys.
      const oauthProviders = Object.entries(modelProviders).filter(
        ([, definition]) =>
          (definition as { authFlow?: string }).authFlow === "oauth-device",
      );
      expect(oauthProviders.length).toBeGreaterThan(0);

      for (const [provider, definition] of oauthProviders) {
        for (const field of Object.keys(getSchemaShape(definition.keysSchema))) {
          expect(
            isSecretCredentialField(field),
            `${provider}.${field} must never be serialized`,
          ).toBe(true);
        }
      }
    });
  });

  describe("given the public credential list", () => {
    it("never names a field that reads as a credential", () => {
      for (const field of PUBLIC_CREDENTIAL_FIELDS) {
        const marker = SECRET_CREDENTIAL_MARKERS.find((m) => field.includes(m));
        expect(
          marker,
          `${field} is on the public list but contains "${marker}"`,
        ).toBeUndefined();
      }
    });

    it("holds no name that no provider stores", () => {
      // A stale entry is a field that was renamed or removed. Left behind, it
      // silently pre-approves the name for whatever claims it next.
      const registryFields = new Set(
        everyRegistryCredentialField().map(({ field }) => field),
      );
      // `MANAGED` is written by the managed-provider flow rather than declared
      // in any provider's schema, so the registry cannot vouch for it.
      registryFields.add("MANAGED");

      for (const field of PUBLIC_CREDENTIAL_FIELDS) {
        expect(registryFields.has(field), `${field} is not in the registry`).toBe(true);
      }
    });

    it("keeps connection settings visible so the form can edit them", () => {
      // The other half of the contract: masking everything would make an
      // endpoint or a region unrecoverable once saved.
      for (const field of [
        "OPENAI_BASE_URL",
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_API_VERSION",
        "AWS_REGION_NAME",
        "VERTEXAI_PROJECT",
        "VERTEXAI_LOCATION",
        "GEMINI_PROJECT",
        "GEMINI_LOCATION",
      ]) {
        expect(isSecretCredentialField(field), `${field} should stay visible`).toBe(
          false,
        );
      }
    });
  });
});
