/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem, Text } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTraceEditStore } from "../../../../stores/traceEditStore";
import {
  CorrectedFieldFrame,
  CorrectedScalar,
  ORIGINAL_PREVIEW_MAX_CHARS,
  previewOriginal,
} from "../CorrectedField";

const CAPTURED_OUTPUT = "the answer is 41";

function renderFrame(original: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <CorrectedFieldFrame label="Output" original={original}>
        <Text>the answer is 42</Text>
      </CorrectedFieldFrame>
    </ChakraProvider>,
  );
}

function editedMarker() {
  return screen.getByRole("button", { name: "Show original output" });
}

describe("CorrectedField", () => {
  beforeEach(() => {
    useTraceEditStore.getState().setDiffOpen(false);
  });

  afterEach(cleanup);

  describe("given a span output a correction replaced", () => {
    describe("when the span detail renders", () => {
      /** @scenario "A corrected field is highlighted and reveals its captured value" */
      it("marks the corrected output as edited", () => {
        renderFrame(CAPTURED_OUTPUT);

        expect(screen.getByText("Edited")).toBeInTheDocument();
        expect(
          document.querySelector('[data-corrected-field="output"]'),
        ).toBeInTheDocument();
      });
    });

    describe("when the reader hovers the edited marker", () => {
      /** @scenario "A corrected field is highlighted and reveals its captured value" */
      it("shows the captured output", async () => {
        renderFrame(CAPTURED_OUTPUT);

        fireEvent.focus(editedMarker());

        expect(await screen.findByText(CAPTURED_OUTPUT)).toBeInTheDocument();
        expect(screen.getByText("Original output")).toBeInTheDocument();
      });
    });
  });

  describe("given a captured value too long to read in a hover", () => {
    describe("when the reader hovers the edited marker", () => {
      /** @scenario "A captured value too long to read in a hover links to the diff" */
      it("shortens it and offers the full difference", async () => {
        const long = "x".repeat(ORIGINAL_PREVIEW_MAX_CHARS + 500);
        renderFrame(long);

        fireEvent.focus(editedMarker());
        const openDiff = await screen.findByText(
          "Open View diff to compare in full.",
        );

        expect(previewOriginal(long).truncated).toBe(true);
        expect(screen.queryByText(long)).not.toBeInTheDocument();

        fireEvent.click(openDiff);
        expect(useTraceEditStore.getState().diffOpen).toBe(true);
      });
    });
  });

  describe("given a scalar a correction replaced", () => {
    describe("when the span detail renders", () => {
      /** @scenario "A corrected span name names its captured name" */
      it("marks it as edited and names the captured value", () => {
        render(
          <ChakraProvider value={defaultSystem}>
            <CorrectedScalar label="Span name" original="web_search">
              <Text>search the web</Text>
            </CorrectedScalar>
          </ChakraProvider>,
        );

        expect(
          screen.getByLabelText("Span name, edited. Original: web_search"),
        ).toBeInTheDocument();
        expect(screen.getByText("Edited")).toBeInTheDocument();
      });
    });
  });

  describe("given a field the trace never carried", () => {
    it("says nothing was captured rather than showing an empty box", () => {
      expect(previewOriginal(null).text).toBe("(nothing captured)");
      expect(previewOriginal("").text).toBe("(nothing captured)");
    });
  });
});
