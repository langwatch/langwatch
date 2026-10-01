/**
 * @vitest-environment jsdom
 *
 * Profile details band integration tests.
 */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import type { FakePersonalHostOptions } from "../../../testing.tsx";
import { ProfileDetailsSection } from "../profile-details-section.tsx";

const updateName = vi.hoisted(() => ({ calls: [] as unknown[], failWith: null as Error | null }));

type NameMutationOptions = { onSuccess?: () => Promise<void>; onError?: (error: Error) => void };

vi.mock("../../../behavior/personal-workspace-api.ts", () => ({
  personalWorkspaceApi: {},
  api: {
    user: {
      updateName: {
        useMutation: (options: NameMutationOptions) => ({
          isPending: false,
          mutate: (input: unknown) => {
            updateName.calls.push(input);
            if (updateName.failWith) options.onError?.(updateName.failWith);
            else void options.onSuccess?.();
          },
        }),
      },
      setAvatar: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      removeAvatar: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
  },
}));

function renderSection(options: FakePersonalHostOptions = {}) {
  const host = fakePersonalWorkspaceHost(options);
  renderWithPersonalWorkspaceHost(<ProfileDetailsSection />, { host });
  return host;
}

function nameInput(): HTMLInputElement {
  return screen.getByTestId("profile-name-input") as HTMLInputElement;
}

function typeName(value: string) {
  fireEvent.change(nameInput(), { target: { value } });
}

const ANA = { id: "user-1", name: "Ana", email: "ana@acme.example", image: null };

afterEach(() => {
  cleanup();
  updateName.calls = [];
  updateName.failWith = null;
});

describe("given a signed-in admin with an organization", () => {
  describe("when the profile opens", () => {
    /** @scenario The first band is my photo, my name and where I stand */
    it("shows the photo, the name, the address and admin standing", () => {
      renderSection({
        currentUser: { id: "user-1", name: "Ana", email: "ana@acme.example", image: null },
        organizationRole: "ADMIN",
      });

      expect(nameInput().value).toBe("Ana");
      expect(screen.getByTestId("profile-email").textContent).toBe("ana@acme.example");
      expect(screen.getByTestId("profile-standing-chip").textContent).toBe("Admin of ACME");
      expect(screen.getByLabelText("Add profile photo")).toBeTruthy();
    });

    /** @scenario A person with no job title is not given one */
    it("claims no job title anywhere on it", () => {
      renderSection({
        currentUser: { id: "user-1", name: "Ana", email: "ana@acme.example", image: null },
        organizationRole: "ADMIN",
      });

      expect(screen.queryByText(/job title/i)).toBeNull();
    });
  });
});

describe("given a member with no organization", () => {
  describe("when the profile opens", () => {
    /** @scenario The first band is my photo, my name and where I stand */
    it("still states the name and address, standing down the photo only", () => {
      renderSection({
        currentUser: { id: "user-1", name: "Ana", email: "ana@acme.example", image: null },
        organization: null,
      });

      expect(nameInput().value).toBe("Ana");
      expect(screen.getByTestId("profile-email").textContent).toBe("ana@acme.example");
      expect(screen.queryByLabelText("Add profile photo")).toBeNull();
    });
  });
});

describe("given a reader on the profile page", () => {
  describe("when they look at their photo", () => {
    /** @scenario The photo control is on the profile page */
    it("can change it without leaving the page", () => {
      renderSection({
        currentUser: { id: "user-1", name: "Ana", email: "ana@acme.example", image: null },
      });

      expect(screen.getByLabelText("Add profile photo")).toBeTruthy();
    });
  });
});

describe("given a reader who changes their name", () => {
  describe("when they set it and save", () => {
    /** @scenario Changing my name saves it */
    it("sends the trimmed name and refreshes the session so every surface follows", async () => {
      const host = renderSection({ currentUser: ANA });

      typeName("  Ana Silva  ");
      fireEvent.click(screen.getByTestId("profile-name-save"));

      expect(updateName.calls).toEqual([{ name: "Ana Silva" }]);
      await waitFor(() => expect(host.recording.sessionRefreshes).toBe(1));
      expect(host.recording.successes.map((notice) => notice.title)).toEqual(["Name updated"]);
    });
  });

  describe("when the name has not changed", () => {
    /** @scenario Save stands down until the name has actually changed */
    it("offers Save only once a different name is typed", () => {
      renderSection({ currentUser: ANA });

      const save = screen.getByTestId("profile-name-save") as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      typeName("Ana Silva");
      expect(save.disabled).toBe(false);
    });
  });

  describe("when they clear the name", () => {
    /** @scenario An empty name is refused before it is sent */
    it("stands Save down and sends nothing", () => {
      renderSection({ currentUser: ANA });

      typeName("   ");
      fireEvent.click(screen.getByTestId("profile-name-save"));

      expect((screen.getByTestId("profile-name-save") as HTMLButtonElement).disabled).toBe(true);
      expect(updateName.calls).toEqual([]);
    });
  });

  describe("when saving fails", () => {
    /** @scenario A name that could not be saved says so */
    it("says it did not save and keeps the typed name", () => {
      updateName.failWith = new Error("boom");
      const host = renderSection({ currentUser: ANA });

      typeName("Ana Silva");
      fireEvent.click(screen.getByTestId("profile-name-save"));

      expect(host.recording.failures.map((failure) => failure.fallbackTitle)).toEqual([
        "Couldn't update your name",
      ]);
      expect(nameInput().value).toBe("Ana Silva");
    });
  });
});
