// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimList } from "../sim-list.tsx";

const ITEMS = [{ id: "a" }, { id: "b" }, { id: "c" }];

const renderList = ({ onSelect }: { onSelect: (key: string) => void }) =>
  render(
    <SimList
      items={ITEMS}
      rowKey={(item) => item.id}
      renderRow={(item) => `Row ${item.id}`}
      selectedKey="a"
      onSelect={onSelect}
      empty="Nothing yet"
    />,
  );

const row = ({ name }: { name: string }) => screen.getByRole("button", { name });

afterEach(() => cleanup());

describe("<SimList/>", () => {
  describe("when the reader works it from the keyboard", () => {
    /** @scenario "A list is worked from the keyboard" */
    it("moves focus with the arrows, Home and End, and stays inside the list", () => {
      renderList({ onSelect: vi.fn() });
      row({ name: "Row a" }).focus();

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
      expect(document.activeElement).toBe(row({ name: "Row b" }));

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "End" });
      expect(document.activeElement).toBe(row({ name: "Row c" }));

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
      expect(document.activeElement).toBe(row({ name: "Row c" }));

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Home" });
      expect(document.activeElement).toBe(row({ name: "Row a" }));

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowUp" });
      expect(document.activeElement).toBe(row({ name: "Row a" }));
    });

    /** @scenario "A list is worked from the keyboard" */
    it("opens a row, answering its key", () => {
      const onSelect = vi.fn();
      renderList({ onSelect });

      fireEvent.click(row({ name: "Row b" }));

      expect(onSelect).toHaveBeenCalledWith("b");
    });
  });

  describe("when a row is selected", () => {
    it("marks it current", () => {
      renderList({ onSelect: vi.fn() });

      expect(row({ name: "Row a" }).getAttribute("aria-current")).toBe("true");
      expect(row({ name: "Row b" }).hasAttribute("aria-current")).toBe(false);
    });
  });

  describe("when there are no items", () => {
    it("shows the empty state", () => {
      render(
        <SimList
          items={[]}
          rowKey={String}
          renderRow={String}
          onSelect={vi.fn()}
          empty="Nothing yet"
        />,
      );

      expect(screen.getByText("Nothing yet")).toBeTruthy();
    });
  });
});
