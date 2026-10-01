/**
 * Integration coverage for specs/traces-v2/media-rendering.feature.
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { parseContentBlocks } from "@langwatch/trace-contract/transcript";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BlockStack } from "../../explorer/trace-drawer/transcript/block-stack.tsx";
import { RenderInputOutput } from "../render-input-output.tsx";

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
        value={JSON.stringify([{ role: "user", content: [imagePart, pdfPart] }])}
      />,
      { wrapper: Wrapper },
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

  /** @scenario "Media inside a typed-raw JSON string still renders as media" */
  it("finds media through a typed-raw envelope whose value is a JSON string", () => {
    const typedRaw = {
      type: "raw",
      value: JSON.stringify([{ role: "user", content: [audioPart, imagePart] }]),
    };

    render(<RenderInputOutput value={JSON.stringify(typedRaw)} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByTestId("media-part-audio")).toBeInTheDocument();
    expect(screen.getByTestId("media-part-image")).toBeInTheDocument();
  });
});
