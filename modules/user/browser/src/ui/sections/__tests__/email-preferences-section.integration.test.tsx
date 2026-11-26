/**
 * @vitest-environment jsdom
 *
 * The weekly digest switch on the Profile page: on, off and on again, and a failed save.
 * Spec: enterprise/modules/digest/specs/digest.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { EmailPreferencesSection } from "../email-preferences-section.tsx";

/** The person's stored choice, which `invalidate` makes the query read again. */
const stored = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    subscribed: true,
    failNextSave: false,
    failReadBack: false,
    failFirstRead: false,
    saves: [] as boolean[],
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: 0,
    changed: () => {
      stored.version += 1;
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("../../../behavior/personal-workspace-api.ts", async () => {
  const { useSyncExternalStore } = await import("react");
  const api = {
    useUtils: () => ({
      digest: {
        getMyPreference: {
          fetch: async () => {
            if (stored.failReadBack) throw new Error("read down");
            stored.changed();
            return { subscribed: stored.subscribed };
          },
        },
      },
    }),
    digest: {
      getMyPreference: {
        useQuery: () => {
          const subscribed = useSyncExternalStore(stored.subscribe, () => stored.subscribed);
          useSyncExternalStore(stored.subscribe, () => stored.version);
          if (stored.failFirstRead) {
            return {
              data: undefined,
              isError: true,
              refetch: async () => {
                stored.failFirstRead = false;
                stored.changed();
              },
            };
          }
          return { data: { subscribed }, isError: false, refetch: async () => {} };
        },
      },
      setMyPreference: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async ({ subscribed }: { subscribed: boolean }) => {
            if (stored.failNextSave) throw new Error("store down");
            stored.saves.push(subscribed);
            stored.subscribed = subscribed;
            return { subscribed };
          },
        }),
      },
    },
  };
  return { personalWorkspaceApi: api, api };
});

beforeEach(() => {
  stored.subscribed = true;
  stored.failNextSave = false;
  stored.failReadBack = false;
  stored.failFirstRead = false;
  stored.saves = [];
});

afterEach(() => cleanup());

const weeklyDigest = () => screen.getByTestId("weekly-digest-switch");
/** What the person sees: the switch's own state, not the hidden input's native flag. */
const isOn = () => weeklyDigest().closest("label")?.getAttribute("data-state") === "checked";

describe("given the email preferences band on the Profile page", () => {
  describe("when the person is subscribed", () => {
    /** @scenario "A person turns the weekly digest off and on in their settings" */
    it("shows the weekly digest on", () => {
      renderWithPersonalWorkspaceHost(<EmailPreferencesSection />, {
        host: fakePersonalWorkspaceHost(),
      });

      expect(screen.getByText("Email preferences")).toBeTruthy();
      expect(isOn()).toBe(true);
    });
  });

  describe("when the person turns it off and then on again", () => {
    /** @scenario "A person turns the weekly digest off and on in their settings" */
    it("saves each choice and shows what was saved", async () => {
      renderWithPersonalWorkspaceHost(<EmailPreferencesSection />, {
        host: fakePersonalWorkspaceHost(),
      });

      await userEvent.click(weeklyDigest());
      await waitFor(() => expect(isOn()).toBe(false));
      await userEvent.click(weeklyDigest());
      await waitFor(() => expect(isOn()).toBe(true));

      expect(stored.saves).toEqual([false, true]);
    });
  });

  describe("when the save fails", () => {
    /** @scenario "A person turns the weekly digest off and on in their settings" */
    it("says so and leaves the switch where it was", async () => {
      stored.failNextSave = true;
      const host = fakePersonalWorkspaceHost();
      renderWithPersonalWorkspaceHost(<EmailPreferencesSection />, { host });

      await userEvent.click(weeklyDigest());

      await waitFor(() =>
        expect(host.recording.failures).toContainEqual(
          expect.objectContaining({ fallbackTitle: "Couldn't save your email preference" }),
        ),
      );
      await waitFor(() => expect(isOn()).toBe(true));
      expect(stored.saves).toEqual([]);
    });
  });

  describe("when the save works but the read-back fails", () => {
    /** @scenario "A person turns the weekly digest off and on in their settings" */
    it("keeps showing the saved choice", async () => {
      stored.failReadBack = true;
      renderWithPersonalWorkspaceHost(<EmailPreferencesSection />, {
        host: fakePersonalWorkspaceHost(),
      });

      await userEvent.click(weeklyDigest());

      await waitFor(() => expect(stored.saves).toEqual([false]));
      expect(isOn()).toBe(false);
    });
  });

  describe("when the stored choice cannot be read", () => {
    /** @scenario "A person turns the weekly digest off and on in their settings" */
    it("offers Try again, which reads it", async () => {
      stored.failFirstRead = true;
      renderWithPersonalWorkspaceHost(<EmailPreferencesSection />, {
        host: fakePersonalWorkspaceHost(),
      });

      await userEvent.click(screen.getByRole("button", { name: "Try again" }));

      await waitFor(() => expect(isOn()).toBe(true));
    });
  });
});
