/**
 * @vitest-environment jsdom
 *
 * Avatar upload control integration tests.
 */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { AvatarUploadControl } from "../avatar-upload-control.tsx";

const CROPPED = "data:image/png;base64,Y3JvcHBlZA==";
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

vi.mock("@langwatch/user-browser-kit", () => ({
  UserAvatar: ({ image }: { image?: string | null }) => (
    <span>{image ? <img src={image} alt="" /> : null}</span>
  ),
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
