// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InlineCode, middleTail } from "../src/components/display/inline-code.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

const ID = "trace_01J9ZK3Q8W7E6R5T4Y3U2I1O0P";

describe("InlineCode", () => {
  describe("given the default end cut", () => {
    it("renders the value whole, titled with itself", () => {
      renderWithDesignSystem(<InlineCode>{ID}</InlineCode>);

      const code = screen.getByTitle(ID);
      expect(code.textContent).toBe(ID);
      expect(code.getAttribute("data-truncate")).toBe("end");
    });
  });

  describe("given a middle cut", () => {
    /** @scenario "A middle cut keeps both ends of an id and copies it whole" */
    it("keeps the whole value in the DOM so a copy takes all of it", () => {
      renderWithDesignSystem(<InlineCode truncate="middle">{ID}</InlineCode>);

      const code = screen.getByTitle(ID);
      expect(code.textContent).toBe(ID);
      expect(code.lastElementChild?.textContent).toBe("2I1O0P");
    });
  });
});

describe("middleTail", () => {
  describe("given a path", () => {
    /** @scenario "A path keeps its last segment through a middle cut" */
    it("keeps the last segment", () => {
      expect(middleTail({ text: "modules/trace/src/index.ts" })).toBe("/index.ts".length);
    });
  });

  describe("given a last segment too long to keep whole", () => {
    it("falls back to six characters", () => {
      expect(middleTail({ text: `a/${"x".repeat(40)}` })).toBe(6);
    });
  });

  describe("given an explicit tail longer than the text", () => {
    it("keeps the whole text", () => {
      expect(middleTail({ text: "abc", tail: 10 })).toBe(3);
    });
  });
});
