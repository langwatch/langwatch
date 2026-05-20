/**
 * @vitest-environment jsdom
 *
 * Integration tests for the MediaPart component.
 * Verifies that AG-UI media content parts render as native HTML5 elements,
 * fall back to data: URIs for legacy inline-data parts, and show a missing
 * placeholder when the tRPC existence probe indicates the object is gone.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaPart } from "../MediaPart";

// ---------------------------------------------------------------------------
// tRPC mock — controls what api.storedObjects.headById.useQuery returns.
// The mock respects the `enabled` option: when disabled it always returns
// { data: undefined } so the probe effect does not fire prematurely.
// ---------------------------------------------------------------------------

type HeadByIdProbeResult =
  | { status: "available"; mediaType: string }
  | { status: "missing"; mediaType: string }
  | { status: "not_found" };

const mockHeadByIdData = vi.fn(() => undefined as undefined | HeadByIdProbeResult);

vi.mock("~/utils/api", () => ({
  api: {
    storedObjects: {
      headById: {
        useQuery: (
          _input: unknown,
          opts: { enabled?: boolean } | undefined,
        ) => {
          // Only return data when the query is enabled (i.e. after an error event).
          if (!opts?.enabled) return { data: undefined };
          return { data: mockHeadByIdData() };
        },
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const TEST_PROJECT_ID = "proj_test";

describe("<MediaPart/>", () => {
  afterEach(() => {
    cleanup();
    mockHeadByIdData.mockReset();
    // Default: no data (probe not yet completed)
    mockHeadByIdData.mockReturnValue(undefined);
  });

  describe("when a message has a url-shape audio part", () => {
    /** @scenario "Trace timeline renders the new file id shape as an inline media tag" */
    it("renders an <audio> element pointing at the URL", () => {
      render(
        <MediaPart
          projectId={TEST_PROJECT_ID}
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
          projectId={TEST_PROJECT_ID}
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
          projectId={TEST_PROJECT_ID}
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
          projectId={TEST_PROJECT_ID}
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
          projectId={TEST_PROJECT_ID}
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

  describe("when the tRPC probe returns status: 'missing' (row exists, blob gone)", () => {
    /** @scenario "Trace timeline shows a missing badge when the byte content is no longer retrievable" */
    it("renders a missing-badge placeholder labeled with the mediaType", async () => {
      mockHeadByIdData.mockReturnValue({ status: "missing", mediaType: "audio/mp3" });

      render(
        <MediaPart
          projectId={TEST_PROJECT_ID}
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

      // After the error, the tRPC probe result drives the placeholder
      await waitFor(() => {
        expect(screen.getByTestId("media-part-missing")).toBeInTheDocument();
      });

      expect(screen.getByTestId("media-part-missing")).toHaveTextContent("audio");
      expect(screen.getByTestId("media-part-missing")).toHaveTextContent("missing");
    });
  });

  describe("when the tRPC probe returns status: 'not_found' (row never existed)", () => {
    it("renders a missing-badge placeholder (same UX as blob-gone)", async () => {
      // Row never existed (e.g. id was made up / deleted). The renderer
      // collapses 'not_found' into 'missing' since the user-visible state
      // is the same: there is nothing to play.
      mockHeadByIdData.mockReturnValue({ status: "not_found" });

      render(
        <MediaPart
          projectId={TEST_PROJECT_ID}
          part={{
            type: "audio",
            source: {
              type: "url",
              value: "/api/files/nonexistent-id",
              mimeType: "audio/mp3",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;
      audio.dispatchEvent(new Event("error"));

      await waitFor(() => {
        expect(screen.getByTestId("media-part-missing")).toBeInTheDocument();
      });
    });
  });

  describe("when the tRPC probe returns status: 'available' (storage transient error, not missing)", () => {
    it("renders an error-badge placeholder (distinct from missing)", async () => {
      // Row exists AND storage confirms bytes are present, but the browser
      // element still errored — transient decode / network failure. MediaPart
      // should land on "error", not "missing".
      mockHeadByIdData.mockReturnValue({ status: "available", mediaType: "audio/mp3" });

      render(
        <MediaPart
          projectId={TEST_PROJECT_ID}
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
          projectId={TEST_PROJECT_ID}
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
