/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SpanDetail } from "@langwatch/trace-contract";
import { CorrectedSpanScalars } from "../corrected-span-scalars";

function detail(over: Partial<SpanDetail>): SpanDetail {
  return {
    spanId: "span-1",
    parentSpanId: null,
    name: "web_search",
    type: "tool",
    startTimeMs: 0,
    endTimeMs: 1,
    durationMs: 1,
    status: "ok",
    events: [],
    ...over,
  } as SpanDetail;
}

function renderScalars(changedFields: ("name" | "type")[]) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <CorrectedSpanScalars
        changedFields={changedFields}
        corrected={detail({ name: "search the web", type: "agent" })}
        captured={detail({})}
      />
    </ChakraProvider>,
  );
}

describe("CorrectedSpanScalars", () => {
  afterEach(cleanup);

  describe("given a correction that renamed the open span", () => {
    describe("when the span detail renders", () => {
      /** @scenario "A corrected span name names its captured name" */
      it("shows the corrected name marked as edited, naming the captured one", () => {
        renderScalars(["name"]);

        expect(screen.getByText("search the web")).toBeInTheDocument();
        expect(
          screen.getByLabelText("Span name, edited. Original: web_search"),
        ).toBeInTheDocument();
      });

      it("says nothing about the type, which the correction left alone", () => {
        renderScalars(["name"]);

        expect(screen.queryByText("Type")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a correction that changed the span type", () => {
    describe("when the span detail renders", () => {
      /** @scenario "A corrected span type names its captured type" */
      it("names the captured type", () => {
        renderScalars(["type"]);

        expect(
          screen.getByLabelText("Span type, edited. Original: tool"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given a correction that touched neither", () => {
    describe("when the span detail renders", () => {
      it("renders nothing at all", () => {
        const { container } = renderScalars([]);

        expect(container).toBeEmptyDOMElement();
      });
    });
  });
});
