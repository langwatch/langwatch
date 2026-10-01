/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getReadUrl } = vi.hoisted(() => ({ getReadUrl: vi.fn() }));

vi.mock("../stored-object-api.ts", () => ({
  storedObjectApi: { storedObjects: { getReadUrl: { useQuery: getReadUrl } } },
}));

const { parseStoredObjectReference } = await import("../parse-stored-object-reference.ts");
const { StoredObjectImage } = await import("../stored-object-image.tsx");
const { useStoredObjectUrl } = await import("../use-stored-object-url.ts");

const REFERENCE = "/api/files/proj-1/so_1/cat.png";
const SIGNED = "/api/stored-objects/so_1/content?sig=abc";

beforeEach(() => getReadUrl.mockReset());

describe("parseStoredObjectReference", () => {
  it.each([
    ["/api/files/p/so_1", { projectId: "p", storedObjectId: "so_1" }],
    [
      "/api/files/p/so_1/cat.png?x=1",
      { projectId: "p", storedObjectId: "so_1", filename: "cat.png" },
    ],
    [
      "/api/files/p/so_1?filename=a%20b.pdf",
      { projectId: "p", storedObjectId: "so_1", filename: "a b.pdf" },
    ],
    ["/api/files/so_legacy", { projectId: undefined, storedObjectId: "so_legacy" }],
    ["https://example.com/a.png", null],
    ["data:image/png;base64,AAAA", null],
  ])("reads %s", (reference, expected) => {
    expect(parseStoredObjectReference(reference)).toEqual(expected);
  });
});

describe("useStoredObjectUrl", () => {
  describe("given a stored-object reference", () => {
    it("asks for a URL for that project and object", () => {
      getReadUrl.mockReturnValue({ data: { url: SIGNED }, isError: false });
      const { result } = renderHook(() => useStoredObjectUrl({ reference: REFERENCE }));
      expect(result.current).toEqual({ status: "ready", url: SIGNED });
      expect(getReadUrl).toHaveBeenCalledWith(
        { projectId: "proj-1", storedObjectId: "so_1", filename: "cat.png" },
        expect.objectContaining({ enabled: true }),
      );
    });

    it("is pending while the URL mints", () => {
      getReadUrl.mockReturnValue({ data: undefined, isError: false });
      const { result } = renderHook(() => useStoredObjectUrl({ reference: REFERENCE }));
      expect(result.current).toEqual({ status: "pending" });
    });

    it("fails when the mint fails", () => {
      getReadUrl.mockReturnValue({ data: undefined, isError: true });
      const { result } = renderHook(() => useStoredObjectUrl({ reference: REFERENCE }));
      expect(result.current).toEqual({ status: "failed" });
    });

    it("asks for the download name the reference carries, or the caller's", () => {
      getReadUrl.mockReturnValue({ data: { url: SIGNED }, isError: false });
      renderHook(() => useStoredObjectUrl({ reference: REFERENCE }));
      expect(getReadUrl).toHaveBeenLastCalledWith(
        { projectId: "proj-1", storedObjectId: "so_1", filename: "cat.png" },
        expect.anything(),
      );
      renderHook(() =>
        useStoredObjectUrl({ reference: "/api/files/proj-1/so_1", filename: "x.pdf" }),
      );
      expect(getReadUrl).toHaveBeenLastCalledWith(
        { projectId: "proj-1", storedObjectId: "so_1", filename: "x.pdf" },
        expect.anything(),
      );
    });

    it("takes the project from the caller for an id-only reference", () => {
      getReadUrl.mockReturnValue({ data: { url: SIGNED }, isError: false });
      renderHook(() => useStoredObjectUrl({ reference: "/api/files/so_1", projectId: "proj-9" }));
      expect(getReadUrl).toHaveBeenCalledWith(
        { projectId: "proj-9", storedObjectId: "so_1" },
        expect.objectContaining({ enabled: true }),
      );
    });

    it("fails for an id-only reference with no project to ask under", () => {
      getReadUrl.mockReturnValue({ data: undefined, isError: false });
      const { result } = renderHook(() => useStoredObjectUrl({ reference: "/api/files/so_1" }));
      expect(result.current).toEqual({ status: "failed" });
    });
  });

  describe("given any other address", () => {
    it("answers it unchanged and mints nothing", () => {
      getReadUrl.mockReturnValue({ data: undefined, isError: false });
      const { result } = renderHook(() =>
        useStoredObjectUrl({ reference: "https://example.com/a.png" }),
      );
      expect(result.current).toEqual({ status: "ready", url: "https://example.com/a.png" });
      expect(getReadUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: false }),
      );
    });
  });
});

describe("StoredObjectImage", () => {
  const renderImage = () =>
    render(
      <ChakraProvider value={defaultSystem}>
        <StoredObjectImage src={REFERENCE} alt="cat" />
      </ChakraProvider>,
    );

  it("draws the minted URL", () => {
    getReadUrl.mockReturnValue({ data: { url: SIGNED }, isError: false });
    renderImage();
    expect(screen.getByAltText("cat")).toHaveAttribute(
      "src",
      expect.stringContaining("so_1/content"),
    );
  });

  it("draws no image while the URL mints", () => {
    getReadUrl.mockReturnValue({ data: undefined, isError: false });
    renderImage();
    expect(screen.queryByAltText("cat")).toBeNull();
  });

  it("hands the reference on when the mint fails, so the broken-image state shows", () => {
    getReadUrl.mockReturnValue({ data: undefined, isError: true });
    renderImage();
    expect(screen.getByAltText("cat")).toHaveAttribute("src", REFERENCE);
  });
});
