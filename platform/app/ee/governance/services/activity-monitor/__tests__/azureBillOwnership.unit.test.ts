import { ValidationError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import {
  type AzureBillReader,
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
