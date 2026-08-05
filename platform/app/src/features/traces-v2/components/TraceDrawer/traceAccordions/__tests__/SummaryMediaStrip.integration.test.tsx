/**
 * @vitest-environment jsdom
 *
 * The drawer summary's media strip renders fold-derived refs from the
 * summary's reserved attributes (specs/traces-v2/media-rendering.feature) —
 * the trace-level input/output are flattened text, so this strip is the only
 * way the summary panel surfaces the winning span's recording / image /
 * attachment. Also pins the metadata-table filter that keeps those reserved
 * JSON blobs out of the attributes section.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  filterReservedMediaRefAttributes,
  SummaryMediaStrip,
} from "../TraceSummaryAccordions";

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

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => cleanup());

describe("SummaryMediaStrip", () => {
  describe("given reserved refs with audio, image, and a named attachment", () => {
    const refsJson = JSON.stringify([
      { kind: "audio", url: "/api/files/p1/a1" },
      { kind: "image", url: "/api/files/p1/i1" },
      {
        kind: "file",
        url: "/api/files/p1/f1",
        filename: "report.pdf",
        mimeType: "application/pdf",
      },
    ]);

    it("renders a player, an inline image, and an attachment chip", () => {
      render(<SummaryMediaStrip refsJson={refsJson} />, { wrapper: Wrapper });

      expect(screen.getByTestId("media-part-audio")).toHaveAttribute(
        "src",
        "/api/files/p1/a1",
      );
      expect(screen.getByTestId("media-part-image")).toHaveAttribute(
        "src",
        "/api/files/p1/i1",
      );
      expect(screen.getByTestId("media-part-binary")).toHaveTextContent(
        "report.pdf",
      );
    });
  });

  describe("given no refs attribute or unparseable JSON", () => {
    it("renders nothing", () => {
      const { container: empty } = render(
        <SummaryMediaStrip refsJson={undefined} />,
        { wrapper: Wrapper },
      );
      expect(empty).toBeEmptyDOMElement();

      const { container: garbage } = render(
        <SummaryMediaStrip refsJson="not json at all" />,
        { wrapper: Wrapper },
      );
      expect(garbage).toBeEmptyDOMElement();
    });
  });

  describe("given a crafted refs attribute smuggling non-stored urls", () => {
    it("renders nothing for external or scripted urls", () => {
      const refsJson = JSON.stringify([
        { kind: "image", url: "https://attacker.example/beacon.png" },
        { kind: "file", url: "javascript:alert(1)", filename: "invoice.pdf" },
      ]);
      const { container } = render(<SummaryMediaStrip refsJson={refsJson} />, {
        wrapper: Wrapper,
      });
      expect(container).toBeEmptyDOMElement();
    });
  });
});

describe("filterReservedMediaRefAttributes", () => {
  it("drops only the reserved media-ref entries from the metadata map", () => {
    expect(
      filterReservedMediaRefAttributes({
        "langwatch.reserved.media_refs.input": "[…]",
        "langwatch.reserved.media_refs.output": "[…]",
        "service.name": "voice-agent",
        "langwatch.user_id": "u1",
      }),
    ).toEqual({
      "service.name": "voice-agent",
      "langwatch.user_id": "u1",
    });
  });
});
