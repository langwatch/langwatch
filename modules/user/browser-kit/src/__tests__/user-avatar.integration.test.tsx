/**
 * @vitest-environment jsdom
 * @see specs/settings/user-avatar.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAvatarUrl } = vi.hoisted(() => ({ getAvatarUrl: vi.fn() }));

vi.mock("../user-api.ts", () => ({
  userApi: { user: { getAvatarUrl: { useQuery: getAvatarUrl } } },
}));

const { UserAvatar } = await import("../user-avatar.tsx");

const STORED = "/api/user-avatar/proj-1/obj-1";
const MINTED = "/api/stored-objects/obj-1/content?sig=abc";

const renderAvatar = (props: { image?: string | null }) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <UserAvatar name="Ada Lovelace" {...props} />
    </ChakraProvider>,
  );

const image = () => document.querySelector("img");

beforeEach(() => getAvatarUrl.mockReset());

describe("UserAvatar", () => {
  describe("given a stored avatar", () => {
    /** @scenario "The uploaded photo renders wherever a person is shown" */
    it("draws the URL minted for that reference", () => {
      getAvatarUrl.mockReturnValue({ data: { url: MINTED } });
      renderAvatar({ image: STORED });

      expect(image()).toHaveAttribute("src", MINTED);
      expect(getAvatarUrl).toHaveBeenCalledWith(
        { projectId: "proj-1", userAvatarId: "obj-1" },
        expect.anything(),
      );
    });

    /** @scenario "A user without a photo still shows their initials everywhere" */
    it("draws the initials, not a broken image, while the URL mints", () => {
      getAvatarUrl.mockReturnValue({ data: undefined });
      renderAvatar({ image: STORED });

      expect(image()).toBeNull();
      expect(screen.getByText("AL")).toBeInTheDocument();
    });

    it("draws the initials when the mint answers no URL", () => {
      getAvatarUrl.mockReturnValue({ data: { url: null } });
      renderAvatar({ image: STORED });

      expect(image()).toBeNull();
      expect(screen.getByText("AL")).toBeInTheDocument();
    });

    it("draws the initials when the mint fails", () => {
      getAvatarUrl.mockReturnValue({ data: undefined, isError: true });
      renderAvatar({ image: STORED });

      expect(image()).toBeNull();
      expect(screen.getByText("AL")).toBeInTheDocument();
    });
  });

  describe("given an image that is not a stored avatar", () => {
    it("uses it as it stands and mints nothing", () => {
      getAvatarUrl.mockReturnValue({ data: undefined });
      renderAvatar({ image: "https://sso.example/photo.png" });

      expect(image()).toHaveAttribute("src", "https://sso.example/photo.png");
      expect(getAvatarUrl).not.toHaveBeenCalled();
    });
  });

  describe("given a removal has cleared the photo", () => {
    /** @scenario "Removing the photo reverts to the fallback avatar" */
    it("falls back to the initials the way a person who never uploaded one does", () => {
      getAvatarUrl.mockReturnValue({ data: { url: MINTED } });
      const { rerender } = renderAvatar({ image: STORED });
      expect(image()).toHaveAttribute("src", MINTED);

      rerender(
        <ChakraProvider value={defaultSystem}>
          <UserAvatar name="Ada Lovelace" image={null} />
        </ChakraProvider>,
      );
      expect(image()).toBeNull();
      expect(screen.getByText("AL")).toBeInTheDocument();
    });
  });

  describe("given no image", () => {
    it("draws the initials", () => {
      getAvatarUrl.mockReturnValue({ data: undefined });
      renderAvatar({});

      expect(image()).toBeNull();
      expect(screen.getByText("AL")).toBeInTheDocument();
    });
  });
});
