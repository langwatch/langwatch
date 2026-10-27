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

const { refusal } = vi.hoisted(() => ({
  refusal: {
    setAvatar: undefined as Error | undefined,
    contextError: null as Error | null,
    contextReads: 0,
  },
}));

/** The wire shape of the retryable refusal sent before the personal project exists. */
const pendingWorkspace = (): Error =>
  Object.assign(new Error("personal_workspace_pending"), {
    code: "personal_workspace_pending",
    httpStatus: 409,
    retryable: true,
  });

vi.mock("../../../behavior/personal-workspace-api.ts", () => ({
  personalWorkspaceApi: {},
  api: {
    useUtils: () => ({
      routingPolicy: {
        personalContext: {
          // The read answers as the server would while the workspace is still being created.
          invalidate: () => {
            refusal.contextReads += 1;
            refusal.contextError = refusal.setAvatar ?? null;
          },
        },
      },
    }),
    routingPolicy: {
      personalContext: {
        useQuery: () => ({ error: refusal.contextError, isFetching: false }),
      },
    },
    user: {
      setAvatar: {
        useMutation: (options: { onError?: (error: Error) => void }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            setAvatar(input);
            if (refusal.setAvatar) options.onError?.(refusal.setAvatar);
          },
        }),
      },
      removeAvatar: { useMutation: () => ({ mutate: removeAvatar, isPending: false }) },
    },
  },
}));

vi.mock("../../../behavior/use-user-avatar-url.ts", () => ({
  useUserAvatarUrl: (image?: string | null) => image ?? null,
}));

vi.mock("@langwatch/design-system/avatar", () => ({
  UserAvatar: ({ src }: { src?: string | null }) => (
    <span>{src ? <img src={src} alt="" /> : null}</span>
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
  refusal.setAvatar = undefined;
  refusal.contextError = null;
  refusal.contextReads = 0;
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

  describe("when the personal workspace is still being set up", () => {
    /** @scenario "Saving a profile photo waits while the personal workspace is set up" */
    it("holds the save with a hint instead of reporting a failure", async () => {
      refusal.setAvatar = pendingWorkspace();
      const host = renderControl(SSO_PHOTO);
      await userEvent.click(screen.getByRole("button", { name: "Edit profile photo" }));
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      fireEvent.change(input!, {
        target: { files: [new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" })] },
      });
      await userEvent.click(await screen.findByRole("button", { name: "Save photo" }));

      expect(host.recording.failures).toEqual([]);
      expect(await screen.findByRole("status")).toHaveTextContent("Setting up your workspace");
      expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();
      expect(refusal.contextReads).toBe(1);
    });
  });
});
