/**
 * @vitest-environment jsdom
 *
 * The Input / Output table cells distinguish redacted content from
 * genuinely-absent content: a privacy-redacted side (the server nulled the
 * text but set `inputRedacted` / `outputRedacted`) renders the shared
 * "Redacted" marker, while a side that is simply empty keeps the em-dash.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// RedactedInline (rendered by the cells when redacted) looks up the org's
// permissions to decide whether to show the "Open privacy settings" link.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

import type { TraceListItem } from "../../../../../../types/trace";
import { InputCell } from "../InputCell";
import { OutputCell } from "../OutputCell";

function row(over: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "t1",
    input: null,
    output: null,
    ...over,
  } as TraceListItem;
}

function renderInput(over: Partial<TraceListItem>) {
  return render(
    <ChakraProvider value={defaultSystem}>
      {InputCell.render({ row: row(over) } as unknown as Parameters<
        typeof InputCell.render
      >[0])}
    </ChakraProvider>,
  );
}

function renderOutput(over: Partial<TraceListItem>) {
  return render(
    <ChakraProvider value={defaultSystem}>
      {OutputCell.render({ row: row(over) } as unknown as Parameters<
        typeof OutputCell.render
      >[0])}
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("Input/Output table cells", () => {
  describe("given the input is redacted by a privacy rule", () => {
    it("shows the Redacted marker instead of an em-dash", () => {
      const { getByText, queryByText } = renderInput({
        input: null,
        inputRedacted: true,
        inputVisibleTo: "Admins",
      });
      expect(getByText("Redacted")).toBeInTheDocument();
      // The audience hint rides along so the reader knows who can see it.
      expect(getByText(/visible to Admins/i)).toBeInTheDocument();
      expect(queryByText("—")).not.toBeInTheDocument();
    });
  });

  describe("given the input is genuinely absent", () => {
    it("keeps the em-dash and shows no Redacted marker", () => {
      const { getByText, queryByText } = renderInput({
        input: null,
        inputRedacted: false,
      });
      expect(getByText("—")).toBeInTheDocument();
      expect(queryByText("Redacted")).not.toBeInTheDocument();
    });
  });

  describe("given the input has visible content", () => {
    it("renders the content and no Redacted marker", () => {
      const { getByText, queryByText } = renderInput({
        input: "hello world",
        inputRedacted: false,
      });
      expect(getByText("hello world")).toBeInTheDocument();
      expect(queryByText("Redacted")).not.toBeInTheDocument();
    });
  });

  describe("given the output is redacted by a privacy rule", () => {
    it("shows the Redacted marker instead of an em-dash", () => {
      const { getByText, queryByText } = renderOutput({
        output: null,
        outputRedacted: true,
        outputVisibleTo: "no one",
      });
      expect(getByText("Redacted")).toBeInTheDocument();
      expect(getByText(/hidden by privacy settings/i)).toBeInTheDocument();
      expect(queryByText("—")).not.toBeInTheDocument();
    });
  });

  describe("given the output is genuinely absent", () => {
    it("keeps the em-dash and shows no Redacted marker", () => {
      const { getByText, queryByText } = renderOutput({
        output: null,
        outputRedacted: false,
      });
      expect(getByText("—")).toBeInTheDocument();
      expect(queryByText("Redacted")).not.toBeInTheDocument();
    });
  });
});
