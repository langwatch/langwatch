/**
 * @vitest-environment jsdom
 *
 * Include / exclude affordance on a facet value row. The row body includes
 * (or clears) a value; a trailing `−` excludes it. This decouples "exclude"
 * from the hidden include→exclude cycle so a single deliberate click does
 * each — see specs/traces-v2/search.feature, rule "Facet value rows expose
 * include and exclude directly".
 *
 * Bound at the component-contract level: the store's NOT-clause behaviour
 * (`excludeFacet`) is unit-tested separately in
 * stores/__tests__/filterStore.unit.test.ts; here we verify the row routes
 * body clicks to `onToggle` and the `−` to `onExclude`.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FacetRow } from "../FacetRow";
import type { FacetItem, FacetValueState } from "../types";

const ITEM: FacetItem = {
  value: "error",
  label: "error",
  count: 12,
  dotColor: "red",
  dimmed: false,
};

const renderRow = ({
  state,
  onToggle = vi.fn(),
  onExclude = vi.fn(),
}: {
  state: FacetValueState;
  onToggle?: (value: string) => void;
  onExclude?: (value: string) => void;
}) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <FacetRow
        item={ITEM}
        state={state}
        maxCount={12}
        onToggle={onToggle}
        onExclude={onExclude}
        field="status"
      />
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
});

describe("<FacetRow /> include / exclude affordance", () => {
  describe("given a neutral value", () => {
    describe("when the row body is clicked", () => {
      /** @scenario "Clicking a neutral value's row body includes it" */
      it("routes to onToggle (include)", () => {
        const onToggle = vi.fn();
        renderRow({ state: "neutral", onToggle });
        fireEvent.click(screen.getByRole("checkbox", { name: /error/i }));
        expect(onToggle).toHaveBeenCalledWith("error");
      });
    });

    describe("when the exclude affordance is clicked", () => {
      /** @scenario "Clicking the exclude affordance on a value excludes it" */
      it("routes to onExclude", () => {
        const onExclude = vi.fn();
        renderRow({ state: "neutral", onExclude });
        fireEvent.click(screen.getByLabelText("Exclude error"));
        expect(onExclude).toHaveBeenCalledWith("error");
      });
    });
  });

  describe("given an included value", () => {
    describe("when the exclude affordance is clicked", () => {
      /** @scenario "Clicking the exclude affordance on an included value flips it to excluded" */
      it("routes to onExclude", () => {
        const onExclude = vi.fn();
        renderRow({ state: "include", onExclude });
        fireEvent.click(screen.getByLabelText("Exclude error"));
        expect(onExclude).toHaveBeenCalledWith("error");
      });
    });
  });

  describe("given an excluded value", () => {
    describe("when the row body is clicked", () => {
      /** @scenario "Clicking the row body of an excluded value clears it back to neutral" */
      it("routes to onToggle (which clears an excluded value)", () => {
        const onToggle = vi.fn();
        renderRow({ state: "exclude", onToggle });
        fireEvent.click(screen.getByRole("checkbox", { name: /error/i }));
        expect(onToggle).toHaveBeenCalledWith("error");
      });
    });

    describe("when rendered", () => {
      it("labels the exclude affordance as a way to stop excluding", () => {
        renderRow({ state: "exclude" });
        expect(
          screen.getByLabelText("Stop excluding error"),
        ).toBeInTheDocument();
      });
    });
  });
});
