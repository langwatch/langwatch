/**
 * A page declares its own Langy context through the kit: registered on mount, cleared on
 * unmount, and not re-registered for the same chips in a fresh array.
 * @vitest-environment jsdom
 * @see specs/langy/langy-context-system.feature
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { datasetContextChip } from "../langy-context-chips.ts";
import {
  useLangyPageContextStore,
  useRegisterLangyPageContext,
} from "../langy-page-context.store.ts";

function DatasetPage({ name }: { name?: string }) {
  useRegisterLangyPageContext(name ? [datasetContextChip({ datasetId: "ds_1", name })] : []);
  return null;
}

beforeEach(() => {
  useLangyPageContextStore.getState().clear();
});

describe("given a dataset page", () => {
  describe("when the page has loaded the dataset", () => {
    it("offers the dataset chip with the dataset's name and its id", () => {
      render(<DatasetPage name="Golden set" />);

      expect(useLangyPageContextStore.getState().pageContext).toEqual([
        { id: "dataset:ds_1", kind: "dataset", label: "dataset: Golden set", ref: "ds_1" },
      ]);
    });
  });

  describe("when the page unmounts", () => {
    it("clears what it declared", () => {
      const page = render(<DatasetPage name="Golden set" />);
      page.unmount();

      expect(useLangyPageContextStore.getState().pageContext).toEqual([]);
    });
  });

  describe("when the page re-renders with the same chips", () => {
    it("keeps the one registration", () => {
      const page = render(<DatasetPage name="Golden set" />);
      const first = useLangyPageContextStore.getState().pageContext;
      page.rerender(<DatasetPage name="Golden set" />);

      expect(useLangyPageContextStore.getState().pageContext).toBe(first);
    });
  });
});
