import { ValidationError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import {
  type AzureBillReader,
  assertAzureBillHasItsOwnCredential,
  assertAzureBillNotAlreadyClaimed,
  readClaimedSubscription,
} from "../azureBillOwnership";

const SUBSCRIPTION = "00000000-0000-4000-8000-000000000001";

const existingReader = (
  overrides: Partial<AzureBillReader> = {},
): AzureBillReader => ({
  id: "src_first",
  name: "Copilot Studio, Europe",
  subscriptionId: SUBSCRIPTION,
  ...overrides,
});

const configNaming = (azureSubscriptionId: string) => ({
  adapter: "copilot_studio_dataverse",
  environmentUrl: "https://orgacme01.crm4.dynamics.com",
  azureSubscriptionId,
});

describe("given a subscription no live source reads yet", () => {
  describe("when an admin saves a source naming it", () => {
    it("saves the source", () => {
      expect(() =>
        assertAzureBillNotAlreadyClaimed({
          parserConfig: configNaming(SUBSCRIPTION),
          claimedBy: [
            existingReader({
              id: "src_other",
              subscriptionId: "11111111-2222-3333-4444-555555555555",
            }),
          ],
        }),
      ).not.toThrow();
    });
  });
});

describe("given a source that already reads a subscription's bill", () => {
  describe("when an admin saves another source naming that same subscription", () => {
    /** @scenario "A subscription another source already reads is refused at save time" */
    it("refuses the source before it is stored", () => {
      expect(() =>
        assertAzureBillNotAlreadyClaimed({
          parserConfig: configNaming(SUBSCRIPTION),
          claimedBy: [existingReader()],
        }),
      ).toThrow(/already reads this Azure subscription's bill/);
    });

    /** @scenario "A subscription another source already reads is refused at save time" */
    it("names the source that already reads it, so the admin knows which one to look at", () => {
      expect(() =>
        assertAzureBillNotAlreadyClaimed({
          parserConfig: configNaming(SUBSCRIPTION),
          claimedBy: [existingReader({ name: "Copilot Studio, Europe" })],
        }),
      ).toThrow(/Copilot Studio, Europe/);
    });

    /** @scenario "A subscription another source already reads is refused at save time" */
    it("carries the explanation where the screen will actually read it", () => {
      // Asserting on the message alone passes whether or not the admin ever
      // sees it: the presentation layer falls back to generic copy unless the
      // sentence is in `meta.formErrors`.
      let thrown: unknown;
      try {
        assertAzureBillNotAlreadyClaimed({
          parserConfig: configNaming(SUBSCRIPTION),
          claimedBy: [existingReader({ name: "Copilot Studio, Europe" })],
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ValidationError);
      const formErrors = (thrown as ValidationError).meta?.formErrors;
      expect(Array.isArray(formErrors)).toBe(true);
      expect((formErrors as string[])[0]).toMatch(/Copilot Studio, Europe/);
    });
  });

  describe("when an admin saves another source naming that subscription in capitals", () => {
    /** @scenario "The same subscription in different letter case is still refused" */
    it("refuses it, because the two spellings name one bill", () => {
      expect(() =>
        assertAzureBillNotAlreadyClaimed({
          parserConfig: configNaming(SUBSCRIPTION.toUpperCase()),
          claimedBy: [existingReader()],
        }),
      ).toThrow(/already reads this Azure subscription's bill/);
    });

    /** @scenario "The same subscription in different letter case is still refused" */
    it("refuses it when the stored one is the capitalised spelling", () => {
      expect(() =>
        assertAzureBillNotAlreadyClaimed({
          parserConfig: configNaming(SUBSCRIPTION),
          claimedBy: [
            existingReader({ subscriptionId: SUBSCRIPTION.toUpperCase() }),
          ],
        }),
      ).toThrow(/already reads this Azure subscription's bill/);
    });

    it("refuses it when the typed one carries surrounding space", () => {
      expect(() =>
        assertAzureBillNotAlreadyClaimed({
          parserConfig: configNaming(`  ${SUBSCRIPTION}  `),
          claimedBy: [existingReader()],
        }),
      ).toThrow(/already reads this Azure subscription's bill/);
    });
  });

  describe("when an admin edits that same source and keeps the subscription", () => {
    /** @scenario "A source keeping the subscription it already reads is saved" */
    it("saves it, rather than colliding the source with itself", () => {
      expect(() =>
        assertAzureBillNotAlreadyClaimed({
          parserConfig: configNaming(SUBSCRIPTION),
          claimedBy: [existingReader({ id: "src_first" })],
          sourceId: "src_first",
        }),
      ).not.toThrow();
    });

    it("still refuses when a different source holds the subscription", () => {
      expect(() =>
        assertAzureBillNotAlreadyClaimed({
          parserConfig: configNaming(SUBSCRIPTION),
          claimedBy: [existingReader({ id: "src_first" })],
          sourceId: "src_second",
        }),
      ).toThrow(/already reads this Azure subscription's bill/);
    });
  });
});

describe("given an admin saving a source that names no Azure subscription", () => {
  describe("when they save the source", () => {
    /** @scenario "A source naming no subscription is left alone" */
    it.each([
      ["the field is absent", undefined],
      ["the field is empty", ""],
      ["the field is only space", "   "],
    ])("saves it when %s", (_case, azureSubscriptionId) => {
      const parserConfig: Record<string, unknown> = {
        adapter: "copilot_studio_dataverse",
        environmentUrl: "https://orgacme01.crm4.dynamics.com",
      };
      if (azureSubscriptionId !== undefined) {
        parserConfig.azureSubscriptionId = azureSubscriptionId;
      }
      expect(() =>
        assertAzureBillNotAlreadyClaimed({
          parserConfig,
          // A reader whose own subscription is blank must not swallow a blank
          // claim: two sources that name nothing are not in conflict.
          claimedBy: [existingReader({ subscriptionId: "" })],
        }),
      ).not.toThrow();
    });
  });
});

describe("given a save that names a subscription and carries credentials", () => {
  const configWithCredentials = (
    credentials: Record<string, unknown>,
  ): Record<string, unknown> => ({
    ...configNaming(SUBSCRIPTION),
    credentials,
  });
  const conversationCredentials = {
    tenantId: "aaaaaaaa-0000-4000-8000-000000000001",
    clientId: "bot-client-id",
    clientSecret: "bot-client-secret",
  };

  describe("when the credentials hold no billing pair", () => {
    /** @scenario "A subscription cannot be saved without its own billing credential" */
    it("refuses the save and says the bill needs its own sign-in", () => {
      expect(() =>
        assertAzureBillHasItsOwnCredential({
          parserConfig: configWithCredentials(conversationCredentials),
        }),
      ).toThrow(/its own app registration/);
    });

    /** @scenario "A subscription cannot be saved without its own billing credential" */
    it.each([
      ["only the billing client id", { billingClientId: "billing-client-id" }],
      [
        "only the billing client secret",
        { billingClientSecret: "billing-client-secret" },
      ],
      [
        "a blank billing secret",
        { billingClientId: "billing-client-id", billingClientSecret: "  " },
      ],
    ])("refuses half a pair too — %s", (_case, half) => {
      expect(() =>
        assertAzureBillHasItsOwnCredential({
          parserConfig: configWithCredentials({
            ...conversationCredentials,
            ...half,
          }),
        }),
      ).toThrow(/its own app registration/);
    });
  });

  describe("when the credentials hold the billing pair", () => {
    it("saves the source", () => {
      expect(() =>
        assertAzureBillHasItsOwnCredential({
          parserConfig: configWithCredentials({
            ...conversationCredentials,
            billingClientId: "billing-client-id",
            billingClientSecret: "billing-client-secret",
          }),
        }),
      ).not.toThrow();
    });
  });

  describe("when no subscription is named", () => {
    it("asks for nothing — there is no bill to sign in to", () => {
      expect(() =>
        assertAzureBillHasItsOwnCredential({
          parserConfig: {
            adapter: "copilot_studio_dataverse",
            credentials: conversationCredentials,
          },
        }),
      ).not.toThrow();
    });
  });

  describe("when the credentials are not readable at this layer", () => {
    // An edit does not resend secrets: the service carries the stored,
    // already-validated envelope across, and by the time this guard sees the
    // config the credentials are either absent or an encrypted string.
    // Whether that is fine depends entirely on whether the CLAIM is new.
    /** @scenario "A subscription cannot be saved without its own billing credential" */
    it.each([
      ["credentials absent", undefined],
      ["credentials already encrypted", "enc:v1:abcdef"],
    ])("refuses a create that claims the bill — %s", (_case, credentials) => {
      // Nothing downstream requires credentials: `createSource` checks the
      // schedule, the plan cap, the source type and the destinations, then
      // writes. So a create naming a subscription with no readable pair is
      // STORED unless it is refused right here — the one remaining way to
      // reach "subscription named, bill unreadable forever".
      const parserConfig: Record<string, unknown> = configNaming(SUBSCRIPTION);
      if (credentials !== undefined) parserConfig.credentials = credentials;
      expect(() =>
        assertAzureBillHasItsOwnCredential({ parserConfig }),
      ).toThrow(/needs its own app registration/i);
    });

    /** @scenario "A subscription cannot be saved without its own billing credential" */
    it("leaves an edit alone when the stored config already claimed the bill", () => {
      // The envelope was proven to hold the billing pair when the claim was
      // first saved. Refusing here would lock an admin out of renaming their
      // own source.
      expect(() =>
        assertAzureBillHasItsOwnCredential({
          parserConfig: {
            ...configNaming(SUBSCRIPTION),
            credentials: "enc:v1:abcdef",
          },
          storedParserConfig: configNaming(SUBSCRIPTION),
        }),
      ).not.toThrow();
    });

    /** @scenario "A subscription cannot be saved without its own billing credential" */
    it.each([
      ["carried across encrypted", "enc:v1:abcdef"],
      ["absent from the edit", undefined],
    ])("refuses an edit that ADDS the claim while the credentials are %s", (_case, credentials) => {
      // The escape this closes: an API edit adding the subscription while
      // the stored envelope rides across unread would store exactly the
      // state the create-path refusal exists to prevent — subscription
      // named, billing pair never checked, bill silent forever.
      const parserConfig: Record<string, unknown> = configNaming(SUBSCRIPTION);
      if (credentials !== undefined) parserConfig.credentials = credentials;
      expect(() =>
        assertAzureBillHasItsOwnCredential({
          parserConfig,
          storedParserConfig: {
            adapter: "copilot_studio_dataverse",
            environmentUrl: "https://orgacme01.crm4.dynamics.com",
          },
        }),
      ).toThrow(/re-enter the credentials/i);
    });
  });
});

describe("given a config that is not a config at all", () => {
  describe("when the claim is read", () => {
    it.each([
      [null],
      [undefined],
      [{ azureSubscriptionId: 12345 }],
    ])("reads no claim from %s", (parserConfig) => {
      expect(
        readClaimedSubscription(
          parserConfig as Record<string, unknown> | null | undefined,
        ),
      ).toBe(null);
    });
  });
});
