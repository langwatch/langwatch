/**
 * @vitest-environment jsdom
 *
 * Integration tests for the MediaPart component.
 * Verifies that AG-UI media content parts render as native HTML5 elements,
 * fall back to data: URIs for legacy inline-data parts, and show a missing
 * placeholder when a URL-based fetch indicates the object is gone.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPart } from "../MediaPart";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<MediaPart/>", () => {
  afterEach(cleanup);

  describe("when a message has a url-shape audio part", () => {
    it("renders an <audio> element pointing at the URL", () => {
      render(
        <MediaPart
          part={{
            type: "audio",
            source: {
              type: "url",
              value: "/api/files/stored-audio-id",
              mimeType: "audio/mp3",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;
      expect(audio).toBeInTheDocument();
      expect(audio.tagName.toLowerCase()).toBe("audio");
      expect(audio).toHaveAttribute("src", "/api/files/stored-audio-id");
      expect(audio).toHaveAttribute("controls");
    });

    it("renders an <img> element for a url-shape image part", () => {
      render(
        <MediaPart
          part={{
            type: "image",
            source: {
              type: "url",
              value: "/api/files/stored-image-id",
              mimeType: "image/png",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const img = screen.getByTestId("media-part-image") as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.tagName.toLowerCase()).toBe("img");
      expect(img).toHaveAttribute("src", "/api/files/stored-image-id");
    });

    it("renders a <video> element for a url-shape video part", () => {
      render(
        <MediaPart
          part={{
            type: "video",
            source: {
              type: "url",
              value: "/api/files/stored-video-id",
              mimeType: "video/mp4",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const video = screen.getByTestId("media-part-video") as HTMLVideoElement;
      expect(video).toBeInTheDocument();
      expect(video.tagName.toLowerCase()).toBe("video");
      expect(video).toHaveAttribute("src", "/api/files/stored-video-id");
      expect(video).toHaveAttribute("controls");
    });
  });

  describe("when a message has an inline-data audio part (legacy)", () => {
    it("renders an <audio> element with a data: URI", () => {
      const base64 = Buffer.from("fake-audio-bytes").toString("base64");

      render(
        <MediaPart
          part={{
            type: "audio",
            source: {
              type: "data",
              value: base64,
              mimeType: "audio/mp3",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;
      expect(audio).toBeInTheDocument();
      expect(audio.tagName.toLowerCase()).toBe("audio");
      expect(audio.getAttribute("src")).toBe(`data:audio/mp3;base64,${base64}`);
    });

    it("renders an <img> element with a data: URI for legacy inline-data image part", () => {
      const base64 = Buffer.from("fake-image-bytes").toString("base64");

      render(
        <MediaPart
          part={{
            type: "image",
            source: {
              type: "data",
              value: base64,
              mimeType: "image/png",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const img = screen.getByTestId("media-part-image") as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.getAttribute("src")).toBe(`data:image/png;base64,${base64}`);
    });
  });

  describe("when an audio fetch returns status missing", () => {
    beforeEach(() => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ status: "missing" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("renders a missing-badge placeholder labeled with the mediaType", async () => {
      render(
        <MediaPart
          part={{
            type: "audio",
            source: {
              type: "url",
              value: "/api/files/missing-audio-id",
              mimeType: "audio/mp3",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      // Simulate native element error event (browser fires this when src 404s)
      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;
      audio.dispatchEvent(new Event("error"));

      // After the error, MediaPart fetches and detects 404 → shows placeholder
      await waitFor(() => {
        expect(screen.getByTestId("media-part-missing")).toBeInTheDocument();
      });

      expect(screen.getByTestId("media-part-missing")).toHaveTextContent("audio");
      expect(screen.getByTestId("media-part-missing")).toHaveTextContent("missing");
    });
  });
});
