// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusDot, type StatusState } from "../status-dot.tsx";

const states: [StatusState, string][] = [
  ["live", "Live"],
  ["starting", "Starting"],
  ["down", "Down"],
  ["unknown", "Unknown"],
];

describe("StatusDot", () => {
  afterEach(() => cleanup());

  describe("when given no label", () => {
    it.each(states)("renders the %s state's word beside the dot", (state, word) => {
      const { container } = render(<StatusDot state={state} />);

      expect(container.textContent).toBe(word);
    });
  });

  describe("when given an empty label", () => {
    it("still renders the state's word, since state is never colour alone", () => {
      const { container } = render(<StatusDot state="down" label="" />);

      expect(container.textContent).toBe("Down");
    });
  });

  describe("when given a label", () => {
    it("renders the label in place of the word", () => {
      const { container } = render(<StatusDot state="live" label="Serving" />);

      expect(container.textContent).toBe("Serving");
    });
  });
});
