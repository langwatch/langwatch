/**
 * @vitest-environment jsdom
 *
 * Profile details band integration tests.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import type { FakePersonalHostOptions } from "../../../testing.tsx";
import { ProfileDetailsSection } from "../profile-details-section.tsx";

vi.mock("../../../behavior/personal-workspace-api.ts", () => ({
  personalWorkspaceApi: {},
  api: {
    user: {
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

afterEach(() => cleanup());

describe("given a signed-in admin with an organization", () => {
  describe("when the profile opens", () => {
    /** @scenario The first band is my photo, my name and where I stand */
    it("shows the photo, the name, the address and admin standing", () => {
      renderSection({
        currentUser: { id: "user-1", name: "Ana", email: "ana@acme.example", image: null },
        organizationRole: "ADMIN",
      });

      expect(screen.getByTestId("profile-name").textContent).toBe("Ana");
      expect(screen.getByTestId("profile-email").textContent).toBe("ana@acme.example");
      expect(screen.getByTestId("profile-standing-chip").textContent).toBe("Admin");
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

      expect(screen.getByTestId("profile-name").textContent).toBe("Ana");
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
