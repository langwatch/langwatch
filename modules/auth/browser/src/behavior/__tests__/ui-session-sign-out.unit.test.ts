/**
 * Signing out ends the session AND leaves the page, by the one route that also
 * ends a federated identity provider's session.
 * Spec: specs/auth/sign-out-leaves-the-page.feature
 * @vitest-environment jsdom
 */

import type * as navigationModule from "@langwatch/browser-host/navigation";
import { isUiNavigatingAway } from "@langwatch/browser-host/navigation";
import type * as queryPersistenceModule from "@langwatch/browser-host/query-persistence";
import { indexedDbQueryStore, storedQueryKey } from "@langwatch/browser-host/query-persistence";
import { readerUiStorage, setUiStorageReader } from "@langwatch/browser-host/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signOutUi } from "../ui-session-client";

/** Each departure, with what this device still remembered at the moment it left. */
const { departures, refusals } = vi.hoisted(() => ({
  departures: [] as { url: string; remembered: number; mirrored: Promise<readonly string[]> }[],
  refusals: { mirroredReads: false },
}));

vi.mock("@langwatch/browser-host/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof navigationModule>();
  return {
    ...actual,
    uiLeaveTo: (url: string) => {
      departures.push({
        url,
        remembered: window.localStorage.length,
        mirrored: indexedDbQueryStore.keys(),
      });
      actual.uiLeaveTo(url);
    },
  };
});

/** A full disk is the real way clearing the mirror fails, so that is what is refused here. */
vi.mock("@langwatch/browser-host/query-persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof queryPersistenceModule>();
  return {
    ...actual,
    clearPersistedUiQueries: async (
      options?: Parameters<typeof actual.clearPersistedUiQueries>[0],
    ) => {
      if (refusals.mirroredReads) {
        throw new DOMException("the disk is full", "QuotaExceededError");
      }
      await actual.clearPersistedUiQueries(options);
    },
  };
});

const mirroredRead = (queryHash: string) =>
  indexedDbQueryStore.put(storedQueryKey({ userId: "user-jane", queryHash }), {
    queryKey: ["organization.all"],
    data: [],
    updatedAt: 1,
    schemaHash: "abc",
  });

beforeEach(async () => {
  departures.length = 0;
  refusals.mirroredReads = false;
  window.localStorage.clear();
  setUiStorageReader(void 0);
  await indexedDbQueryStore
    .keys()
    .then((keys) => Promise.all(keys.map((key) => indexedDbQueryStore.delete(key))));
});

describe("signOutUi()", () => {
  describe("when a signed-in reader signs out", () => {
    /** @scenario "Signing out takes the reader off the page they were on" */
    it("leaves this document, so the reader never sits on a page they are signed out of", async () => {
      await signOutUi();

      expect(isUiNavigatingAway()).toBe(true);
    });

    /** @scenario "Signing out leaves by the route that ends a federated session too" */
    it("leaves for the logout route, which ends the identity provider's session too", async () => {
      await signOutUi();

      expect(departures.at(-1)?.url).toBe("/api/auth/logout");
    });
  });

  describe("when this device remembered the reader's choices", () => {
    /** @scenario "Signing out forgets this device's remembered preferences before leaving" */
    it("has forgotten them by the time it leaves, since nothing of ours runs after", async () => {
      setUiStorageReader("user-jane");
      readerUiStorage.setItem("probe:panel", '{"width":480}');

      await signOutUi();

      expect(departures.at(-1)?.remembered).toBe(0);
    });
  });

  describe("when this device mirrored the reader's reads", () => {
    /** @scenario "Signing out forgets this device's mirrored reads before leaving" */
    it("has cleared the mirror by the time it leaves, not somewhere after", async () => {
      await mirroredRead("the-read-they-last-looked-at");

      await signOutUi();

      await expect(departures.at(-1)?.mirrored).resolves.toEqual([]);
    });
  });

  describe("when this device refuses to give up what it remembered", () => {
    /** @scenario "A device that cannot be forgotten is still left" */
    it("still leaves for the logout route, the session being over either way", async () => {
      refusals.mirroredReads = true;

      await signOutUi();

      expect(departures.at(-1)?.url).toBe("/api/auth/logout");
    });

    /** @scenario "A device that cannot be forgotten is still left" */
    it("settles rather than rejecting, since a screen's control only lets go of it", async () => {
      refusals.mirroredReads = true;

      await expect(signOutUi()).resolves.toBeUndefined();
    });
  });
});
