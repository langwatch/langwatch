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
import { filterReservedMediaRefAttributes, SummaryMediaStrip } from "../trace-summary-accordions";

vi.mock("../../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_test" } }),
}));

vi.mock("../../../../trace-api", () => ({
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
      render(<SummaryMediaStrip refsJson={refsJson} side="input" />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("media-part-audio")).toHaveAttribute("src", "/api/files/p1/a1");
      expect(screen.getByTestId("media-part-image")).toHaveAttribute("src", "/api/files/p1/i1");
      expect(screen.getByTestId("media-part-binary")).toHaveTextContent("report.pdf");
    });
  });

  describe("given no refs attribute or unparseable JSON", () => {
    it("renders nothing", () => {
      const { container: empty } = render(<SummaryMediaStrip refsJson={undefined} side="input" />, {
        wrapper: Wrapper,
      });
      expect(empty).toBeEmptyDOMElement();

      const { container: garbage } = render(
        <SummaryMediaStrip refsJson="not json at all" side="input" />,
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
      const { container } = render(<SummaryMediaStrip refsJson={refsJson} side="input" />, {
        wrapper: Wrapper,
      });
      expect(container).toBeEmptyDOMElement();
    });
  });

  // A voice turn's span input holds the caller's recording AND the agent's
  // reply, so both refs ride the same reserved attribute. Without the side
  // split the summary stacked two players under INPUT for one spoken turn.
  describe("given a voice turn whose refs carry both roles", () => {
    const refsJson = JSON.stringify([
      { kind: "audio", url: "/api/files/p1/spoken", role: "user" },
      { kind: "audio", url: "/api/files/p1/reply", role: "assistant" },
    ]);

    /** @scenario "The summary input strip carries only the audio spoken into the trace" */
    it("plays only the caller's recording under the input strip", () => {
      render(<SummaryMediaStrip refsJson={refsJson} side="input" />, {
        wrapper: Wrapper,
      });

      const players = screen.getAllByTestId("media-part-audio");
      expect(players).toHaveLength(1);
      expect(players[0]).toHaveAttribute("src", "/api/files/p1/spoken");
    });

    /** @scenario "The summary output strip carries only the reply audio" */
    it("plays only the agent's reply under the output strip", () => {
      render(<SummaryMediaStrip refsJson={refsJson} side="output" />, {
        wrapper: Wrapper,
      });

      const players = screen.getAllByTestId("media-part-audio");
      expect(players).toHaveLength(1);
      expect(players[0]).toHaveAttribute("src", "/api/files/p1/reply");
    });
  });

  describe("given refs recorded before roles existed", () => {
    const refsJson = JSON.stringify([{ kind: "audio", url: "/api/files/p1/a1" }]);

    /** @scenario "Media refs recorded without a role render on both summary strips" */
    it("renders the recording on both strips, exactly as before", () => {
      for (const side of ["input", "output"] as const) {
        const { unmount } = render(<SummaryMediaStrip refsJson={refsJson} side={side} />, {
          wrapper: Wrapper,
        });
        expect(screen.getByTestId("media-part-audio")).toHaveAttribute("src", "/api/files/p1/a1");
        unmount();
      }
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
