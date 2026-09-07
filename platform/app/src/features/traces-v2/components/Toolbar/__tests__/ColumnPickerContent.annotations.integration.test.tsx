/**
 * @vitest-environment jsdom
 *
 * Who is offered the Annotations column. Reviews are a team's own judgements,
 * so a reader who may not see them is not offered a column that could only
 * ever come up blank.
 *
 * See specs/traces-v2/trace-list-annotations-column.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  permissions: { annotationsView: true },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    hasPermission: (permission: string) =>
      permission === "annotations:view"
        ? harness.permissions.annotationsView
        : true,
  }),
}));

vi.mock("../../../hooks/useEvaluatorOptions", () => ({
  useEvaluatorOptions: () => ({ options: [], nameByKey: new Map() }),
}));

vi.mock("../../../stores/viewStore", () => ({
  useViewStore: (selector: (s: unknown) => unknown) =>
    selector({
      columnOrder: ["time", "trace"],
      grouping: "flat",
      toggleColumn: vi.fn(),
      reorderColumns: vi.fn(),
    }),
}));

vi.mock("../../../stores/timeFormatStore", () => ({
  useTimeFormatStore: (selector: (s: unknown) => unknown) =>
    selector({ format: "relative", setFormat: vi.fn() }),
}));

import { ColumnPickerContent } from "../ColumnPickerContent";

afterEach(cleanup);

beforeEach(() => {
  harness.permissions.annotationsView = true;
});

function renderPicker() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ColumnPickerContent />
    </ChakraProvider>,
  );
}

/** The column toggles the reader can actually turn on, by their label. */
const toggleFor = (label: string) =>
  screen.queryByRole("checkbox", { name: label });

describe("ColumnPickerContent", () => {
  describe("given a reader who may see annotations", () => {
    describe("when they open the column picker", () => {
      it("offers them the Annotations column", () => {
        renderPicker();

        expect(toggleFor("Annotations")).toBeInTheDocument();
      });
    });
  });

  describe("given a reader who may not see annotations", () => {
    describe("when they open the column picker", () => {
      /** @scenario "The column is not offered to a reader who may not see annotations" */
      it("does not offer them the Annotations column", () => {
        harness.permissions.annotationsView = false;

        renderPicker();

        expect(toggleFor("Annotations")).not.toBeInTheDocument();
        // The rest of the picker is untouched.
        expect(toggleFor("Events")).toBeInTheDocument();
      });
    });
  });
});
