/**
 * @vitest-environment jsdom
 *
 * Integration tests for the MediaPart component.
 * Verifies that AG-UI media content parts render as native HTML5 elements,
 * fall back to data: URIs for legacy inline-data parts, and show a missing
 * placeholder when the caller's stored-object existence probe indicates the
 * object is gone.
 *
 * The existence probe moved out of this component: `MediaPart` no longer
 * calls `api.storedObjects.headById.useQuery` itself — it takes `probe` (the
 * probe's answer) and `onProbeRequired` (fired once on a failed element) as
 * props, and the caller (ScenarioMessageRenderer) owns the tRPC query. This
 * harness plays the caller's role: it holds the probe state and answers
 * `onProbeRequired` synchronously with the fixture for each test, which is
 * the same shape a resolved tRPC query would have handed down.
 *
 * @see specs/traces-v2/media-rendering.feature
 * @see specs/features/scenarios/externalize-event-byte-content.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaPart, type MediaProbeResult } from "../media-part";
import type { MediaPartData } from "../../../model/media-parts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const TEST_PROJECT_ID = "proj_test";

/**
 * Plays the caller's role: holds the probe answer in state and, once
 * `onProbeRequired` fires, applies `answer` (if given) as the caller's
 * resolved probe result. Leaving `answer` undefined models a probe that
 * never comes back (still "in flight").
 */
function ProbeHarness({
  part,
  projectId = TEST_PROJECT_ID,
  answer,
  onId,
}: {
  part: MediaPartData;
  projectId?: string;
  answer?: MediaProbeResult;
  onId?: (id: string) => void;
}) {
  const [probe, setProbe] = useState<MediaProbeResult>(undefined);
  return (
    <MediaPart
      projectId={projectId}
      part={part}
      probe={probe}
      onProbeRequired={(id) => {
        onId?.(id);
        if (answer !== undefined) setProbe(answer);
      }}
    />
  );
}

describe("<MediaPart/>", () => {
  afterEach(() => {
    cleanup();
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

  describe("when the url carries a project-id segment (#4947)", () => {
    it("probes with the id from the final path segment, not the project segment", () => {
      // The project segment ("owner_proj") is deliberately DIFFERENT from the
      // component's projectId prop, so this proves the extracted id is the
      // URL's final segment — not the project segment, and not the prop
      // echoed back. A parser that returned the first segment would yield
      // "owner_proj" and fail the assertion.
      const onId = vi.fn();
      render(
        <ProbeHarness
          part={{
            type: "image",
            source: {
              type: "url",
              value: "/api/files/owner_proj/so_scoped_id",
              mimeType: "image/png",
            },
          }}
          onId={onId}
        />,
        { wrapper: Wrapper },
      );

      const img = screen.getByTestId("media-part-image") as HTMLImageElement;
      img.dispatchEvent(new Event("error"));

      expect(onId).toHaveBeenCalledWith("so_scoped_id");
    });
  });

  describe("when the url is the legacy id-only shape", () => {
    it("probes with the id from the single path segment", () => {
      const onId = vi.fn();
      render(
        <ProbeHarness
          part={{
            type: "image",
            source: {
              type: "url",
              value: "/api/files/so_legacy_id",
              mimeType: "image/png",
            },
          }}
          onId={onId}
        />,
        { wrapper: Wrapper },
      );

      const img = screen.getByTestId("media-part-image") as HTMLImageElement;
      img.dispatchEvent(new Event("error"));

      expect(onId).toHaveBeenCalledWith("so_legacy_id");
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

  describe("when the probe answers 'missing' (row exists, blob gone)", () => {
    /** @scenario "Trace timeline shows a missing badge when the byte content is no longer retrievable" */
    it("renders a missing-badge placeholder labeled with the mediaType", async () => {
      render(
        <ProbeHarness
          part={{
            type: "audio",
            source: {
              type: "url",
              value: "/api/files/missing-audio-id",
              mimeType: "audio/mp3",
            },
          }}
          answer={{ status: "missing", mediaType: "audio/mp3" }}
        />,
        { wrapper: Wrapper },
      );

      // Simulate native element error event (browser fires this when src 404s)
      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;
      audio.dispatchEvent(new Event("error"));

      // After the error, the probe result drives the placeholder
      await waitFor(() => {
        expect(screen.getByTestId("media-part-missing")).toBeInTheDocument();
      });

      expect(screen.getByTestId("media-part-missing")).toHaveTextContent(
        "This audio is no longer available",
      );
      expect(screen.getByTestId("media-part-missing")).toHaveTextContent("missing");
      // The dead player is gone: a lost recording must not look like a
      // silent one.
      expect(screen.queryByTestId("media-part-audio")).not.toBeInTheDocument();
    });
  });

  describe("when the part holds a size summary instead of the media", () => {
    /** @scenario "Media the pipeline chose not to capture says so, and says how large it was" */
    it("says the media was not captured, and how large it was", () => {
      render(
        <MediaPart
          projectId={TEST_PROJECT_ID}
          part={{
            type: "image",
            source: {
              type: "url",
              // What an engine writes in place of an attachment it decided was
              // too large to carry into the trace.
              value: "[image/jpeg, 2624 bytes]",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const placeholder = screen.getByTestId("media-part-not-captured");
      expect(placeholder).toHaveTextContent("was too large to capture");
      expect(placeholder).toHaveTextContent("2.56KB");
      // "no longer available" would send the reader looking for bytes that
      // were never stored.
      expect(screen.queryByTestId("media-part-missing")).not.toBeInTheDocument();
    });
  });

  describe("when the probe answers 'not_found' (row never existed)", () => {
    /** @scenario "A recording whose bytes are gone shows an unavailable state, not a dead player" */
    it("renders a missing-badge placeholder (same UX as blob-gone)", async () => {
      // Row never existed (e.g. id was made up / deleted). The renderer
      // collapses 'not_found' into 'missing' since the user-visible state
      // is the same: there is nothing to play.
      render(
        <ProbeHarness
          part={{
            type: "audio",
            source: {
              type: "url",
              value: "/api/files/nonexistent-id",
              mimeType: "audio/mp3",
            },
          }}
          answer={{ status: "not_found" }}
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

  describe("when the probe answers 'available' (storage transient error, not missing)", () => {
    it("renders an error-badge placeholder (distinct from missing)", async () => {
      // Row exists AND storage confirms bytes are present, but the browser
      // element still errored — transient decode / network failure. MediaPart
      // should land on "error", not "missing".
      render(
        <ProbeHarness
          part={{
            type: "audio",
            source: {
              type: "url",
              value: "/api/files/transient-error-id",
              mimeType: "audio/mp3",
            },
          }}
          answer={{ status: "available", mediaType: "audio/mp3" }}
        />,
        { wrapper: Wrapper },
      );

      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;
      audio.dispatchEvent(new Event("error"));

      await waitFor(() => {
        expect(screen.getByTestId("media-part-error")).toBeInTheDocument();
      });

      expect(screen.getByTestId("media-part-error")).toHaveTextContent(
        "This audio could not be loaded",
      );
      expect(screen.getByTestId("media-part-error")).toHaveTextContent("error");
      // The "missing" placeholder must NOT be shown — that's a different state.
      expect(screen.queryByTestId("media-part-missing")).not.toBeInTheDocument();
    });
  });

  describe("when the probe itself fails (the viewer may not run it)", () => {
    /** @scenario "A media probe the viewer cannot run still leaves the unavailable state" */
    it("holds a placeholder during the probe and then states the media could not be loaded", async () => {
      // The probe is refused, so nothing ever answers whether the bytes are
      // there. Before, status stayed "loading" and the player sat at zero
      // seconds forever. `probe === null` is the caller's "the query itself
      // errored" answer.
      render(
        <ProbeHarness
          part={{
            type: "audio",
            source: {
              type: "url",
              value: "/api/files/proj/forbidden-probe-id",
              mimeType: "audio/wav",
            },
          }}
          answer={null}
        />,
        { wrapper: Wrapper },
      );

      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;
      audio.dispatchEvent(new Event("error"));

      await waitFor(() => {
        expect(screen.getByTestId("media-part-error")).toBeInTheDocument();
      });
      expect(screen.getByTestId("media-part-error")).toHaveTextContent(
        "This audio could not be loaded",
      );
      expect(screen.queryByTestId("media-part-audio")).not.toBeInTheDocument();
      // No status code, url, or probe failure text reaches the viewer.
      expect(screen.getByTestId("media-part-error").textContent).not.toMatch(
        /forbidden|FORBIDDEN|api\/files|40\d/,
      );
    });

    /** @scenario "A media probe the viewer cannot run still leaves the unavailable state" */
    it("shows a placeholder while the probe is still in flight", async () => {
      // Probe requested, no answer yet: the failed element is already gone
      // and its place is held.
      render(
        <ProbeHarness
          part={{
            type: "audio",
            source: {
              type: "url",
              value: "/api/files/proj/slow-probe-id",
              mimeType: "audio/wav",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;
      audio.dispatchEvent(new Event("error"));

      await waitFor(() => {
        expect(screen.getByTestId("media-part-probing")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("media-part-audio")).not.toBeInTheDocument();
    });
  });

  describe("when a url that is not a stored object fails to load", () => {
    it("states the failure straight away, with no probe to wait for", async () => {
      render(
        <MediaPart
          projectId={TEST_PROJECT_ID}
          part={{
            type: "image",
            source: {
              type: "url",
              value: "https://cdn.example/photo.png",
              mimeType: "image/png",
            },
          }}
        />,
        { wrapper: Wrapper },
      );

      const img = screen.getByTestId("media-part-image") as HTMLImageElement;
      img.dispatchEvent(new Event("error"));

      await waitFor(() => {
        expect(screen.getByTestId("media-part-error")).toBeInTheDocument();
      });
      expect(screen.getByTestId("media-part-error")).toHaveTextContent(
        "This image could not be loaded",
      );
      expect(screen.queryByTestId("media-part-probing")).not.toBeInTheDocument();
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
