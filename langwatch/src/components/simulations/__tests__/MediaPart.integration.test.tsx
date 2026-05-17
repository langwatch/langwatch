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
    /** @scenario "Trace timeline renders the new file id shape as an inline media tag" */
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
    /** @scenario "Trace timeline still renders legacy inline base64 file shapes unchanged" */
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

    /** @scenario "Trace timeline shows a missing badge when the byte content is no longer retrievable" */
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

  describe("when an audio fetch returns a transient 502 (storage error, not missing)", () => {
    beforeEach(() => {
      // HEAD probe returns 502 — the row exists but the storage backend
      // reported a transient failure. MediaPart should land on the "error"
      // state, not "missing", so the user knows the bytes weren't gone,
      // they just couldn't be served right now.
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "file temporarily unavailable" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("renders an error-badge placeholder (distinct from missing)", async () => {
      render(
        <MediaPart
          part={{
            type: "audio",
            source: {
              type: "url",
              value: "/api/files/transient-error-id",
              mimeType: "audio/mp3",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;
      audio.dispatchEvent(new Event("error"));

      await waitFor(() => {
        expect(screen.getByTestId("media-part-error")).toBeInTheDocument();
      });

      expect(screen.getByTestId("media-part-error")).toHaveTextContent("audio");
      expect(screen.getByTestId("media-part-error")).toHaveTextContent("error");
      // The "missing" placeholder must NOT be shown — that's a different state.
      expect(screen.queryByTestId("media-part-missing")).not.toBeInTheDocument();
    });
  });

  describe("when the browser fires loadeddata on a URL-shape audio part", () => {
    /** @scenario "MediaPart audio playback reports a non-zero duration once the browser has decoded the media" */
    it("the <audio> element exposes controls and a non-zero duration so the play button is enabled", async () => {
      render(
        <MediaPart
          part={{
            type: "audio",
            source: {
              type: "url",
              value: "/api/files/playable-audio-id",
              mimeType: "audio/mp3",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;

      // jsdom does not actually decode media, so the browser would fire
      // `loadeddata` once it has the first sample buffer. Simulate that
      // event and inject a realistic duration value on the element — both
      // are what a real browser hands to MediaPart when the bytes load.
      Object.defineProperty(audio, "duration", {
        configurable: true,
        get: () => 12.5, // 12.5 seconds — any positive value is enough for AC39
      });
      audio.dispatchEvent(new Event("loadeddata"));

      // The element must be the same `<audio>` (no transition to the
      // error placeholder on the happy path).
      await waitFor(() => {
        expect(screen.getByTestId("media-part-audio")).toBeInTheDocument();
      });

      // Duration is positive — the AC39 acceptance for "player duration
      // is greater than zero".
      expect(audio.duration).toBeGreaterThan(0);

      // The native browser play button is exposed through the `controls`
      // attribute. With duration > 0 and `controls` on, the browser
      // enables the play button — there's no extra MediaPart-side gating
      // to assert beyond these two.
      expect(audio).toHaveAttribute("controls");

      // The "missing" / "error" placeholders must NOT appear.
      expect(screen.queryByTestId("media-part-missing")).not.toBeInTheDocument();
      expect(screen.queryByTestId("media-part-error")).not.toBeInTheDocument();
    });
  });
});
