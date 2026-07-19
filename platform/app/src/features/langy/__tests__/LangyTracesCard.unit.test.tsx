/**
 * @vitest-environment jsdom
 *
 * A card must never manufacture a confident answer out of output it could not
 * read. When the tool output fails BOTH the JSON contract parse and the legacy
 * markdown-digest parse (e.g. JSON truncated upstream at the 8KB tool-output
 * cap), this card used to render "0 traces — No traces matched" — a definitive
 * WRONG answer. Unreadable and empty are different states and must render
 * differently.
 *
 * @see specs/langy/langy-capability-cards.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LangyTracesCard } from "../components/capabilities/LangyTracesCard";
import { resolveCapability } from "../components/capabilities/capabilityRegistry";

const descriptor = resolveCapability("langwatch.trace.search")!;

function renderCard(output: unknown) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyTracesCard
        descriptor={descriptor}
        input={{}}
        output={output}
        projectSlug="acme"
      />
    </ChakraProvider>,
  );
}

describe("LangyTracesCard", () => {
  describe("given a structured result with matches", () => {
    describe("when the card renders", () => {
      it("lists the matched traces under an honest count", () => {
        renderCard({
          traces: [{ trace_id: "trace_1" }, { trace_id: "trace_2" }],
          pagination: { totalHits: 2 },
        });

        expect(screen.getByText("2 traces")).toBeTruthy();
        expect(screen.getByText("trace_1")).toBeTruthy();
      });
    });
  });

  describe("given a structured result that genuinely matched nothing", () => {
    describe("when the card renders", () => {
      it("says no traces matched — a real answer, not a failure", () => {
        renderCard({ traces: [], pagination: { totalHits: 0 } });

        expect(screen.getByText("No traces matched.")).toBeTruthy();
        expect(screen.getByText("0 traces")).toBeTruthy();
      });
    });
  });

  describe("given a legacy markdown digest that says zero", () => {
    describe("when the card renders", () => {
      it("still reads the honest zero out of the digest", () => {
        renderCard("Found 0 traces");

        expect(screen.getByText("0 traces")).toBeTruthy();
        expect(screen.getByText("No traces matched.")).toBeTruthy();
      });
    });
  });

  describe("given output the card cannot read", () => {
    // Truncated JSON: fails the contract parse AND the digest parse.
    const truncated = '{"traces":[{"trace_id":"trace_1","input":{"va';

    describe("when the card renders", () => {
      it("owns the failure instead of claiming zero traces matched", () => {
        renderCard(truncated);

        expect(screen.getByText(/Couldn.t read this result/)).toBeTruthy();
        expect(screen.queryByText("No traces matched.")).toBeNull();
        expect(screen.queryByText(/0 traces/)).toBeNull();
      });

      it("still offers the way into Traces", () => {
        renderCard(truncated);

        // The card shell's own deep link into the Traces surface.
        expect(screen.getByText(/Open in/i)).toBeTruthy();
      });
    });
  });
});
