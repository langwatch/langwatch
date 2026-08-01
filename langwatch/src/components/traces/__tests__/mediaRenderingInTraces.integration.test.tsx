/**
 * @vitest-environment jsdom
 *
 * Integration coverage for specs/traces-v2/media-rendering.feature.
 *
 * Renders both trace UIs with image / attachment / audio message content and
 * asserts real media widgets appear (inline image, attachment chip, player)
 * instead of a raw JSON dump — including when the media hides inside a
 * typed-raw envelope whose value is a JSON string.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { BlockStack } from "~/features/traces-v2/components/TraceDrawer/transcript/BlockStack";
import { parseContentBlocks } from "~/features/traces-v2/components/TraceDrawer/transcript/parsing";
import { RenderInputOutput } from "../RenderInputOutput";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_test" } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    storedObjects: {
      headById: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

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

// Externalized references — the production shapes after ingest-side
// content extraction.
const imagePart = {
  type: "image_url",
  image_url: { url: "/api/files/p1/img1" },
};
const pdfPart = {
  type: "binary",
  mimeType: "application/pdf",
  url: "/api/files/p1/f1",
  filename: "report.pdf",
};
const audioPart = {
  type: "input_audio",
  input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
};

afterEach(cleanup);

describe("Media rendering in trace views", () => {
  /** @scenario "The legacy input/output view surfaces images and attachments" */
  it("legacy input/output view shows an inline image and an attachment chip", () => {
    render(
      <RenderInputOutput
        value={JSON.stringify([
          { role: "user", content: [imagePart, pdfPart] },
        ])}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByTestId("media-part-image")).toHaveAttribute(
      "src",
      "/api/files/p1/img1",
    );
    const chip = screen.getByTestId("media-part-binary");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("report.pdf");
  });

  /** @scenario "The drawer chat view renders an externalized image inline" */
  it("traces-v2 conversation view renders the image inline instead of the JSON part", () => {
    const blocks = parseContentBlocks([imagePart]);
    expect(blocks).toEqual([expect.objectContaining({ kind: "media" })]);

    render(<BlockStack blocks={blocks} toolCalls={[]} />, { wrapper: Wrapper });

    expect(screen.getByTestId("media-part-image")).toBeInTheDocument();
  });

  /** @scenario "The drawer chat view renders a PDF attachment as a file chip" */
  it("traces-v2 conversation view renders a PDF as a named attachment chip", () => {
    const blocks = parseContentBlocks([pdfPart]);

    render(<BlockStack blocks={blocks} toolCalls={[]} />, { wrapper: Wrapper });

    const chip = screen.getByTestId("media-part-binary");
    expect(chip).toHaveTextContent("report.pdf");
  });

  /** @scenario "The drawer plays an externalized pcm16 recording" */
  it("wraps a legacy raw-pcm16 reference into playable WAV on the client", async () => {
    // Legacy stored object: raw pcm16 bytes served under audio/pcm16 (before
    // store-time wrapping existed). The client must fetch + wrap + play.
    const pcmBytes = new Uint8Array([0, 0, 16, 32, 255, 127, 0, 128]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => pcmBytes.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn().mockReturnValue("blob:wrapped-audio");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    try {
      render(
        <RenderInputOutput
          value={JSON.stringify([
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: {
                    url: "/api/files/p1/legacy-pcm",
                    mimeType: "audio/pcm16",
                  },
                },
              ],
            },
          ])}
        />,
        { wrapper: Wrapper },
      );

      const audio = await screen.findByTestId("media-part-audio");
      // Until the wrap resolves the element has no src; afterwards it plays
      // from the wrapped blob, never from the raw unplayable bytes.
      await vi.waitFor(() => {
        expect(audio).toHaveAttribute("src", "blob:wrapped-audio");
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/p1/legacy-pcm",
        expect.objectContaining({ credentials: "same-origin" }),
      );
      const blob = createObjectURL.mock.calls[0]![0] as Blob;
      expect(blob.type).toBe("audio/wav");
      expect(blob.size).toBe(44 + pcmBytes.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /** @scenario "Media inside a typed-raw JSON string still renders as media" */
  it("finds media through a typed-raw envelope whose value is a JSON string", () => {
    const typedRaw = {
      type: "raw",
      value: JSON.stringify([
        { role: "user", content: [audioPart, imagePart] },
      ]),
    };

    render(<RenderInputOutput value={JSON.stringify(typedRaw)} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByTestId("media-part-audio")).toBeInTheDocument();
    expect(screen.getByTestId("media-part-image")).toBeInTheDocument();
  });
});
