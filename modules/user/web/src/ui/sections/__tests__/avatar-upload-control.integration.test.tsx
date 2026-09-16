/**
 * @vitest-environment jsdom
 *
 * Avatar upload control integration tests.
 */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { UserAvatar } from "../../elements/user-avatar.tsx";
import { AvatarUploadControl } from "../avatar-upload-control.tsx";

const CROPPED = "data:image/png;base64,Y3JvcHBlZA==";
const UPLOADED = "/api/user-avatar/project-1/object-1";
const SSO_PHOTO = "https://cdn.identity.test/photos/carol.png";

/** What the control sends, and all these need to record is THAT it sent. */
type AvatarMutate = (input: unknown) => void;

const setAvatar = vi.fn<AvatarMutate>();
const removeAvatar = vi.fn<AvatarMutate>();

vi.mock("../../../behavior/personal-workspace-api.ts", () => ({
  personalWorkspaceApi: {},
  api: {
    user: {
      setAvatar: { useMutation: () => ({ mutate: setAvatar, isPending: false }) },
      removeAvatar: { useMutation: () => ({ mutate: removeAvatar, isPending: false }) },
    },
  },
}));

vi.mock("../../../model/process-avatar-image.ts", () => ({
  processAvatarImage: vi.fn<(file: File) => Promise<string>>(async () => CROPPED),
}));

function renderControl(image: string | null) {
  const host = fakePersonalWorkspaceHost({
    currentUser: { id: "user-1", name: "Carol", email: "carol@acme.example", image },
  });
  renderWithPersonalWorkspaceHost(<AvatarUploadControl organizationId="org-1" />, { host });
  return host;
}

/** The photo an avatar element is currently showing, or nothing when it fell back. */
function shownPhoto(): string | null {
  return document.querySelector("img")?.getAttribute("src") ?? null;
}

/**
 * Every photo on screen — two avatars show at once while the dialog is
 * open: the small one on the settings page keeps showing what is SAVED, the
 * large one in the dialog shows what would be saved. The assertion reads the set.
 */
function shownPhotos(): (string | null)[] {
  return Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("src"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given a signed-in user on their profile settings", () => {
  describe("when they choose an image file", () => {
    /** @scenario "The profile settings show a live preview before saving" */
    it("shows the cropped photo in place of their current one, and saves nothing yet", async () => {
      renderControl(SSO_PHOTO);
      await userEvent.click(screen.getByRole("button", { name: "Edit profile photo" }));
      await userEvent.click(screen.getByRole("button", { name: "Change photo" }));

      // The file input is the hidden one the "Change photo" button clicks, so
      // the file arrives as a change event rather than as a pointer gesture.
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      fireEvent.change(input!, {
        target: { files: [new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" })] },
      });

      // The preview replaces what is on screen while the photo is still only a
      // choice: "Save photo" is what commits it, and nothing has been sent.
      await waitFor(() => expect(shownPhotos()).toContain(CROPPED));
      expect(screen.getByRole("button", { name: "Save photo" })).toBeTruthy();
      expect(setAvatar).not.toHaveBeenCalled();
    });
  });
});

/**
 * UserAvatar tests: fallback chain of image -> initials -> silhouette.
 */
describe("given the element every person-avatar surface renders", () => {
  describe("when the person has uploaded a photo", () => {
    /** @scenario "The uploaded photo renders wherever a person is shown" */
    it("displays the photo rather than their initials", () => {
      renderWithPersonalWorkspaceHost(<UserAvatar name="Carol Danvers" image={UPLOADED} />, {
        host: fakePersonalWorkspaceHost(),
      });

      expect(shownPhoto()).toBe(UPLOADED);
    });
  });

  describe("when the person has no photo at all", () => {
    /** @scenario "A user without a photo still shows their initials everywhere" */
    it("displays their initials, with no image element to break", () => {
      renderWithPersonalWorkspaceHost(<UserAvatar name="Carol Danvers" image={null} />, {
        host: fakePersonalWorkspaceHost(),
      });

      expect(shownPhoto()).toBeNull();
      expect(screen.getByText("CD")).toBeTruthy();
    });
  });

  describe("when a removal has cleared the photo", () => {
    /** @scenario "Removing the photo reverts to the fallback avatar" */
    it("falls back to the initials the way a person who never uploaded one does", () => {
      const { rerender } = renderWithPersonalWorkspaceHost(
        <UserAvatar name="Carol Danvers" image={UPLOADED} />,
        { host: fakePersonalWorkspaceHost() },
      );
      expect(shownPhoto()).toBe(UPLOADED);

      rerender(<UserAvatar name="Carol Danvers" image={null} />);

      expect(shownPhoto()).toBeNull();
      expect(screen.getByText("CD")).toBeTruthy();
    });
  });
});
