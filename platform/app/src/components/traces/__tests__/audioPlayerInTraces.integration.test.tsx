/**
 * @vitest-environment jsdom
 *
 * Integration coverage for
 * specs/trace-processing/audio-player-in-traces.feature.
 *
 * Renders both trace UIs with audio message content and asserts an inline
 * <audio> player appears (instead of only a raw JSON dump): the legacy
 * `RenderInputOutput` input/output view, and the traces-v2 conversation
 * `BlockStack`. These bind the feature's @integration scenarios via
 * @scenario annotations, so the parity check sees real rendering coverage —
 * not just the unit-level parsing tests.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { BlockStack } from "~/features/traces-v2/components/TraceDrawer/transcript/BlockStack";
import { parseContentBlocks } from "~/features/traces-v2/components/TraceDrawer/transcript/parsing";
import { RenderInputOutput } from "../RenderInputOutput";

// TraceAudioPart resolves the owning project from context; MediaPart needs a
// real id for its stored-object existence probe.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_test" } }),
}));

// tRPC existence probe — always idle (no data) so url-shape players render
// their <audio> element instead of transitioning to a missing/error badge.
vi.mock("~/utils/api", () => ({
  api: {
    storedObjects: {
      headById: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

// The legacy view lazy-loads react-json-view; stub the dynamic loader so the
// JSON pane stays out of jsdom (the audio players render above it regardless).
vi.mock("~/utils/compat/next-dynamic", () => ({
  default: () =>
    function StubbedDynamic() {
      return null;
    },
}));

vi.mock("~/components/ui/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// An OpenAI Realtime "input_audio" recording, already externalized to a
// stored-object URL — the production shape after content extraction.
const inputAudioPart = {
  type: "input_audio",
  input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
};

// An AG-UI "audio" content part with a url source.
const aguiAudioPart = {
  type: "audio",
  source: { type: "url", value: "/api/files/p1/a2", mimeType: "audio/wav" },
};

afterEach(cleanup);

describe("Audio player in trace views", () => {
  /** @scenario "Legacy trace view plays an input_audio recording" */
  it("legacy input/output view shows an inline player for an input_audio recording", () => {
    render(
      <RenderInputOutput
        value={JSON.stringify([{ role: "user", content: [inputAudioPart] }])}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("media-part-audio")).toBeInTheDocument();
  });

  /** @scenario "Conversation view plays an input_audio recording" */
  it("traces-v2 conversation view shows an inline player instead of raw JSON", () => {
    // The input_audio part must parse to a media block, not a raw JSON block.
    const blocks = parseContentBlocks([inputAudioPart]);
    expect(blocks).toEqual([expect.objectContaining({ kind: "media" })]);

    render(<BlockStack blocks={blocks} toolCalls={[]} />, { wrapper: Wrapper });

    expect(screen.getByTestId("media-part-audio")).toBeInTheDocument();
  });

  /** @scenario "Both input_audio and AG-UI audio shapes are supported" */
  it("renders a distinct player for each of an input_audio and an AG-UI audio recording", () => {
    render(
      <RenderInputOutput
        value={JSON.stringify([
          { role: "user", content: [inputAudioPart] },
          { role: "assistant", content: [aguiAudioPart] },
        ])}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getAllByTestId("media-part-audio")).toHaveLength(2);
  });
});
