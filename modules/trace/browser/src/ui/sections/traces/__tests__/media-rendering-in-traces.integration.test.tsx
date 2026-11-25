/**
 * Integration coverage for specs/traces-v2/media-rendering.feature.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { parseContentBlocks } from "@langwatch/trace-contract/transcript";
import { cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TerminalOutput } from "../../../elements/coding-agent/trace/terminal-output.tsx";
import { TranscriptRenderProvider } from "../../../elements/transcript-render-ports.tsx";
import { BlockStack } from "../../transcript/block-stack.tsx";
import { RenderInputOutput } from "../render-input-output.tsx";
import { TraceMediaPart } from "../trace-media-part.tsx";

vi.mock(
  "../../../../behavior/lent-media-part.tsx",
  () => import("../../__tests__/lent-media-part.stand-in.tsx"),
);

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_test" } }),
}));

vi.mock("../../../../behavior/trace-api.ts", () => ({
  api: {
    storedObjects: {
      headById: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

vi.mock("@microlink/react-json-view", () => ({
  default: function StubbedReactJson() {
    return null;
  },
}));

vi.mock("@langwatch/design-system/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));

vi.mock("@langwatch/design-system/toaster", () => ({
  toaster: { create: vi.fn() },
}));

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
    renderWithDesignSystem(
      <RenderInputOutput
        value={JSON.stringify([{ role: "user", content: [imagePart, pdfPart] }])}
      />,
    );

    expect(screen.getByTestId("media-part-image")).toHaveAttribute("src", "/api/files/p1/img1");
    const chip = screen.getByTestId("media-part-binary");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("report.pdf");
  });

  /** @scenario "The drawer chat view renders an externalized image inline" */
  it("traces-v2 conversation view renders the image inline instead of the JSON part", () => {
    const blocks = parseContentBlocks([imagePart]);
    expect(blocks).toEqual([expect.objectContaining({ kind: "media" })]);

    renderWithDesignSystem(
      <TranscriptRenderProvider
        renderMediaPart={(part) => <TraceMediaPart part={part} />}
        renderTerminalOutput={(text, isError) => <TerminalOutput text={text} isError={isError} />}
      >
        <BlockStack blocks={blocks} toolCalls={[]} />
      </TranscriptRenderProvider>,
    );

    expect(screen.getByTestId("media-part-image")).toBeInTheDocument();
  });

  /** @scenario "The drawer chat view renders a PDF attachment as a file chip" */
  it("traces-v2 conversation view renders a PDF as a named attachment chip", () => {
    const blocks = parseContentBlocks([pdfPart]);

    renderWithDesignSystem(
      <TranscriptRenderProvider
        renderMediaPart={(part) => <TraceMediaPart part={part} />}
        renderTerminalOutput={(text, isError) => <TerminalOutput text={text} isError={isError} />}
      >
        <BlockStack blocks={blocks} toolCalls={[]} />
      </TranscriptRenderProvider>,
    );

    const chip = screen.getByTestId("media-part-binary");
    expect(chip).toHaveTextContent("report.pdf");
  });

  /** @scenario "Media inside a typed-raw JSON string still renders as media" */
  it("finds media through a typed-raw envelope whose value is a JSON string", () => {
    const typedRaw = {
      type: "raw",
      value: JSON.stringify([{ role: "user", content: [audioPart, imagePart] }]),
    };

    renderWithDesignSystem(<RenderInputOutput value={JSON.stringify(typedRaw)} />);

    expect(screen.getByTestId("media-part-audio")).toBeInTheDocument();
    expect(screen.getByTestId("media-part-image")).toBeInTheDocument();
  });
});
