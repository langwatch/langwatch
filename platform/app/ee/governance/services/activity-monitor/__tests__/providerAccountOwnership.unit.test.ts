// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One connection per provider account and report, refused at save time.
 *
 * Azure and Power Platform name what they read in the config, so the guard can
 * read the identity straight off the form. OpenAI and Anthropic name nothing:
 * an administrator key reads the whole organisation's spend and the admin never
 * types which organisation that is. So the account is ASKED FOR while the
 * connection is being saved, and the answer — the provider's own account id —
 * is what is compared and what is kept.
 *
 * Two consequences fall out of asking rather than comparing keys, and both are
 * bound below: a second key belonging to the same organisation is refused even
 * though it is a different secret, and nothing derived from the key needs to be
 * stored for the guard to work.
 *
 * The report is part of the identity because two reports about one account
 * cannot bill the same money twice — one connection reads token usage, another
 * reads spend, and refusing that pair leaves a customer who wants both having
 * to pick one.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Decision: 00d claim C, settlements 6, 7 and 8.
 */

import { ValidationError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";
// Not yet implemented: the provider-account arm of the
// one-connection-per-account rule, plus the save-time account lookup it calls.
import {
  assertProviderAccountIsFree,
  type ProviderAccountReader,
} from "../providerAccountOwnership";

const ACCOUNT = "org_test_anthropic_0001";
const OTHER_ACCOUNT = "org_test_anthropic_0002";

/** The key the first connection was saved with. Obviously fake. */
const FIRST_KEY = "sk-ant-admin-FIRSTKEY-0000000000";
/** A second administrator key on the same organisation — a rotation overlap. */
const SECOND_KEY = "sk-ant-admin-SECONDKEY-000000000";

const existingReader = (
  overrides: Partial<ProviderAccountReader> = {},
): ProviderAccountReader => ({
  id: "src_first",
  name: "Anthropic spend, first",
  providerAccountId: ACCOUNT,
  report: "cost",
  disabled: false,
  ...overrides,
});

const configCarrying = (apiKey: string, report: "usage" | "cost") => ({
  adapter: "anthropic_admin",
  report,
  credentials: { apiKey },
});

/**
 * The provider, answering which account a key belongs to.
 *
 * Keyed by the key so a test can say "a different secret, the same
 * organisation" — which is the case comparing keys to each other misses.
 */
const providerSaying = (byKey: Record<string, string>) =>
  vi.fn(async ({ parserConfig }: { parserConfig: Record<string, unknown> }) => {
    const credentials = parserConfig.credentials as { apiKey: string };
    const account = byKey[credentials.apiKey];
    if (!account) throw new Error("unknown key in this fixture");
    return account;
  });

describe("given a connection already reading a provider account through an administrator key", () => {
  describe("when the admin saves another connection carrying that same key for that same report", () => {
    /** @scenario "A second connection reading the same report from an account already connected is refused" */
    it("refuses the save and names the connection that already reads that account", async () => {
      const lookUpProviderAccount = providerSaying({ [FIRST_KEY]: ACCOUNT });

      await expect(
        assertProviderAccountIsFree({
          sourceType: "anthropic_admin",
          parserConfig: configCarrying(FIRST_KEY, "cost"),
          claimedBy: [existingReader({ name: "Anthropic spend, first" })],
          lookUpProviderAccount,
        }),
      ).rejects.toThrow(/Anthropic spend, first/);
    });

    it("carries the complaint where the screen will actually read it", async () => {
      // Asserting on the message alone passes whether or not the admin ever
      // sees it: the presentation layer falls back to generic copy unless the
      // sentence is in `meta.formErrors`.
      const lookUpProviderAccount = providerSaying({ [FIRST_KEY]: ACCOUNT });
      const thrown = await assertProviderAccountIsFree({
        sourceType: "anthropic_admin",
        parserConfig: configCarrying(FIRST_KEY, "cost"),
        claimedBy: [existingReader({ name: "Anthropic spend, first" })],
        lookUpProviderAccount,
      }).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(ValidationError);
      const formErrors = (thrown as ValidationError).meta?.formErrors;
      expect((formErrors as string[])[0]).toMatch(/Anthropic spend, first/);
    });

    it("asks the provider which account the key belongs to, rather than comparing keys", async () => {
      // The account is asked for by name while the connection is being saved,
      // which is what makes the refusal hold whether or not the second
      // connection carries the same key as the first.
      const lookUpProviderAccount = providerSaying({ [FIRST_KEY]: ACCOUNT });

      await assertProviderAccountIsFree({
        sourceType: "anthropic_admin",
        parserConfig: configCarrying(FIRST_KEY, "cost"),
        claimedBy: [existingReader()],
        lookUpProviderAccount,
      }).catch(() => undefined);

      expect(lookUpProviderAccount).toHaveBeenCalledOnce();
    });
  });

  describe("when the admin saves another connection carrying a different key for that same account", () => {
    /** @scenario "A second key belonging to an account already connected is refused" */
    it("refuses it too, because both keys read the same whole-organisation spend", async () => {
      // One organisation holds several administrator keys — a rotation
      // overlap, a second admin, a service key beside a personal one. Every
      // one of them reads the same spend, and comparing the keys to each
      // other refuses none of these.
      const lookUpProviderAccount = providerSaying({
        [FIRST_KEY]: ACCOUNT,
        [SECOND_KEY]: ACCOUNT,
      });

      await expect(
        assertProviderAccountIsFree({
          sourceType: "anthropic_admin",
          parserConfig: configCarrying(SECOND_KEY, "cost"),
          claimedBy: [existingReader({ name: "Anthropic spend, first" })],
          lookUpProviderAccount,
        }),
      ).rejects.toThrow(/Anthropic spend, first/);
    });

    it("still saves a key that belongs to a different account", async () => {
      const lookUpProviderAccount = providerSaying({
        [SECOND_KEY]: OTHER_ACCOUNT,
      });

      await expect(
        assertProviderAccountIsFree({
          sourceType: "anthropic_admin",
          parserConfig: configCarrying(SECOND_KEY, "cost"),
          claimedBy: [existingReader()],
          lookUpProviderAccount,
        }),
      ).resolves.toMatchObject({ providerAccountId: OTHER_ACCOUNT });
    });
  });
});

describe("given a connection reading token usage from a provider account", () => {
  describe("when the admin saves another connection reading spend from that same account", () => {
    /** @scenario "A usage connection and a cost connection may read the same account" */
    it("accepts the save — two reports about one account bill nothing twice", async () => {
      const lookUpProviderAccount = providerSaying({ [SECOND_KEY]: ACCOUNT });

      await expect(
        assertProviderAccountIsFree({
          sourceType: "anthropic_admin",
          parserConfig: configCarrying(SECOND_KEY, "cost"),
          claimedBy: [
            existingReader({ report: "usage", name: "Anthropic usage" }),
          ],
          lookUpProviderAccount,
        }),
      ).resolves.toMatchObject({ providerAccountId: ACCOUNT });
    });
  });
});

describe("given a connection reading a provider account that the admin has disabled", () => {
  describe("when the admin saves another connection naming that same account for that same report", () => {
    /** @scenario "A disabled connection still holds the account it read" */
    it("refuses the save and says the disabled connection has to be archived first", async () => {
      // A disabled connection can be turned back on, and the day it is, the
      // two of them start counting the same money. Archiving is the act that
      // gives the account up, so the refusal has to name it.
      const lookUpProviderAccount = providerSaying({ [SECOND_KEY]: ACCOUNT });

      await expect(
        assertProviderAccountIsFree({
          sourceType: "anthropic_admin",
          parserConfig: configCarrying(SECOND_KEY, "cost"),
          claimedBy: [
            existingReader({ disabled: true, name: "Anthropic spend, first" }),
          ],
          lookUpProviderAccount,
        }),
      ).rejects.toThrow(/archive/i);
    });

    it("still names the disabled connection, so the admin knows which to archive", async () => {
      const lookUpProviderAccount = providerSaying({ [SECOND_KEY]: ACCOUNT });

      await expect(
        assertProviderAccountIsFree({
          sourceType: "anthropic_admin",
          parserConfig: configCarrying(SECOND_KEY, "cost"),
          claimedBy: [
            existingReader({ disabled: true, name: "Anthropic spend, first" }),
          ],
          lookUpProviderAccount,
        }),
      ).rejects.toThrow(/Anthropic spend, first/);
    });
  });
});

describe("given the connection being saved is the one that already holds the account", () => {
  describe("when it is checked", () => {
    it("does not collide the connection with itself", async () => {
      const lookUpProviderAccount = providerSaying({ [FIRST_KEY]: ACCOUNT });

      await expect(
        assertProviderAccountIsFree({
          sourceType: "anthropic_admin",
          parserConfig: configCarrying(FIRST_KEY, "cost"),
          claimedBy: [existingReader({ id: "src_first" })],
          sourceId: "src_first",
          lookUpProviderAccount,
        }),
      ).resolves.toMatchObject({ providerAccountId: ACCOUNT });
    });
  });
});
