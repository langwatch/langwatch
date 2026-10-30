/**
 * Signing out ends the session AND leaves the page, by the one route that also
 * ends a federated identity provider's session.
 * Spec: specs/auth/sign-out-leaves-the-page.feature
 * @vitest-environment jsdom
 */

import type * as navigationModule from "@langwatch/browser-host/navigation";
import { isUiNavigatingAway } from "@langwatch/browser-host/navigation";
import { readerUiStorage, setUiStorageReader } from "@langwatch/browser-host/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signOutUi } from "../ui-session-client";

/** Each departure, with what this device still remembered at the moment it left. */
const { departures } = vi.hoisted(() => ({
  departures: [] as { url: string; remembered: number }[],
}));

vi.mock("@langwatch/browser-host/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof navigationModule>();
  return {
    ...actual,
    uiLeaveTo: (url: string) => {
      departures.push({ url, remembered: window.localStorage.length });
      actual.uiLeaveTo(url);
    },
  };
});

beforeEach(() => {
  departures.length = 0;
  window.localStorage.clear();
  setUiStorageReader(void 0);
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
    /** @scenario "Signing out forgets this device's memory of the reader before leaving" */
    it("has forgotten them by the time it leaves, since nothing of ours runs after", async () => {
      setUiStorageReader("user-jane");
      readerUiStorage.setItem("probe:panel", '{"width":480}');

      await signOutUi();

      expect(departures.at(-1)?.remembered).toBe(0);
    });
  });
});
