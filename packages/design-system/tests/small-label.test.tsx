// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SmallLabel } from "../src/components/small-label";
import { renderWithDesignSystem } from "../src/testing";

afterEach(() => cleanup());

describe("SmallLabel", () => {
  describe("given label text", () => {
    it("renders the text as a paragraph carrying the shared label class", () => {
      renderWithDesignSystem(<SmallLabel>Scope</SmallLabel>);

      const label = screen.getByText("Scope");
      expect(label.tagName).toBe("P");
      expect(label.className).not.toBe("");
    });
  });

  describe("given props of its own", () => {
    it("forwards them to the underlying text", () => {
      renderWithDesignSystem(
        <SmallLabel data-testid="scope-label" as="span">
          Scope
        </SmallLabel>,
      );

      expect(screen.getByTestId("scope-label").tagName).toBe("SPAN");
    });
  });
});
