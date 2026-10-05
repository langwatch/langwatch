/**
 * @vitest-environment jsdom
 * @see specs/settings/user-avatar.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAvatarUrl } = vi.hoisted(() => ({ getAvatarUrl: vi.fn() }));

vi.mock("../user-api.ts", () => ({
  userApi: { user: { getAvatarUrl: { useQuery: getAvatarUrl } } },
}));

const { useUserAvatarUrl } = await import("../use-user-avatar-url.ts");

const STORED = "/api/user-avatar/proj-1/obj-1";
const MINTED = "/api/stored-objects/obj-1/content?sig=abc";

beforeEach(() => getAvatarUrl.mockReset());

describe("useUserAvatarUrl", () => {
  describe("given a stored avatar", () => {
    /** @scenario "The uploaded photo renders wherever a person is shown" */
    it("answers the URL minted for that reference", () => {
      getAvatarUrl.mockReturnValue({ data: { url: MINTED } });
      const { result } = renderHook(() => useUserAvatarUrl(STORED));

      expect(result.current).toBe(MINTED);
      expect(getAvatarUrl).toHaveBeenCalledWith(
        { projectId: "proj-1", userAvatarId: "obj-1" },
        expect.objectContaining({ enabled: true }),
      );
    });

    /** @scenario "A user without a photo still shows their initials everywhere" */
    it("answers null while the URL mints", () => {
      getAvatarUrl.mockReturnValue({ data: undefined });
      const { result } = renderHook(() => useUserAvatarUrl(STORED));

      expect(result.current).toBeNull();
    });

    it("answers null when the mint answers no URL", () => {
      getAvatarUrl.mockReturnValue({ data: { url: null } });
      const { result } = renderHook(() => useUserAvatarUrl(STORED));

      expect(result.current).toBeNull();
    });

    it("answers null when the mint fails", () => {
      getAvatarUrl.mockReturnValue({ data: undefined, isError: true });
      const { result } = renderHook(() => useUserAvatarUrl(STORED));

      expect(result.current).toBeNull();
    });
  });

  describe("given an image that is not a stored avatar", () => {
    it("answers it as it stands and mints nothing", () => {
      getAvatarUrl.mockReturnValue({ data: undefined });
      const { result } = renderHook(() => useUserAvatarUrl("https://sso.example/photo.png"));

      expect(result.current).toBe("https://sso.example/photo.png");
      expect(getAvatarUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: false }),
      );
    });
  });

  describe("given a removal has cleared the photo", () => {
    /** @scenario "Removing the photo reverts to the fallback avatar" */
    it("answers null, the way a person who never uploaded one does", () => {
      getAvatarUrl.mockReturnValue({ data: { url: MINTED } });
      const stored: string | null = STORED;
      const { result, rerender } = renderHook<
        ReturnType<typeof useUserAvatarUrl>,
        { image: string | null }
      >(({ image }) => useUserAvatarUrl(image), {
        initialProps: { image: stored },
      });
      expect(result.current).toBe(MINTED);

      rerender({ image: null });

      expect(result.current).toBeNull();
    });
  });
});
