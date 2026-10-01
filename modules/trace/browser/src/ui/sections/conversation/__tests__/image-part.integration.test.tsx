/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mint } = vi.hoisted(() => ({ mint: vi.fn() }));

vi.mock("@langwatch/stored-object-browser-kit", () => ({ useStoredObjectUrl: mint }));

import { ImagePart } from "../parts.tsx";

const part = { kind: "image", id: "img-1", src: "/api/files/p1/i1", role: "user" } as const;

const renderPart = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ImagePart part={part} />
    </ChakraProvider>,
  );

describe("ImagePart", () => {
  describe("given the stored image's URL mints", () => {
    it("loads the image from the minted URL", () => {
      mint.mockReturnValue({ status: "ready", url: "/api/stored-objects/i1/content?sig=abc" });
      renderPart();

      expect(screen.getByAltText("Image from user")).toHaveAttribute(
        "src",
        "/api/stored-objects/i1/content?sig=abc",
      );
      expect(mint).toHaveBeenCalledWith({ reference: "/api/files/p1/i1" });
    });
  });

  describe("given the URL is still minting", () => {
    it("draws no image, so nothing shows broken", () => {
      mint.mockReturnValue({ status: "pending" });
      renderPart();

      expect(screen.queryByAltText("Image from user")).toBeNull();
      expect(screen.queryByText("Image unavailable")).toBeNull();
    });
  });

  describe("given the URL cannot be minted", () => {
    it("says the image is unavailable instead of drawing a broken one", () => {
      mint.mockReturnValue({ status: "failed" });
      renderPart();

      expect(screen.queryByAltText("Image from user")).toBeNull();
      expect(screen.getByText("Image unavailable")).toBeInTheDocument();
    });
  });
});
