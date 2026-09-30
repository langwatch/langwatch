// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SimConsole } from "../sim-console.tsx";

const TABS = [
  { id: "calls", label: "Calls", count: 3 },
  { id: "settings", label: "Settings" },
];

const Harness = () => {
  const [tab, setTab] = useState("calls");
  return (
    <SimConsole
      sim="llm"
      title="LLM simulator"
      stackSlug="feature-one"
      tabs={TABS}
      activeTab={tab}
      onTab={setTab}
      status={{ tone: "ok", text: "Serving" }}
      actions={<button type="button">Reset</button>}
    >
      <p>{`Showing ${tab}`}</p>
    </SimConsole>
  );
};

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => cleanup());

describe("<SimConsole/>", () => {
  describe("when it renders", () => {
    /** @scenario "The header names the simulator, its stack and its state" */
    it("names the simulator, its stack and its state, beside the actions", () => {
      render(<Harness />);

      expect(screen.getByText("LLM simulator")).toBeTruthy();
      expect(screen.getByText("feature-one")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe("Live");
      expect(screen.getByRole("status").getAttribute("title")).toBe("Serving");
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: /Calls/u }).getAttribute("aria-selected")).toBe(
        "true",
      );
    });
  });

  describe("when a tab is picked", () => {
    /** @scenario "The open tab is kept in the address" */
    it("opens it and writes it to the hash", () => {
      render(<Harness />);

      fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

      expect(screen.getByText("Showing settings")).toBeTruthy();
      expect(window.location.hash).toBe("#settings");
    });
  });

  describe("when the address names a tab", () => {
    /** @scenario "The open tab is kept in the address" */
    it("opens that tab on load", () => {
      window.history.replaceState(null, "", "/#settings");
      render(<Harness />);

      expect(screen.getByText("Showing settings")).toBeTruthy();
    });

    /** @scenario "The open tab is kept in the address" */
    it("follows the hash when it changes", () => {
      render(<Harness />);

      window.history.replaceState(null, "", "/#settings");
      fireEvent(window, new HashChangeEvent("hashchange"));

      expect(screen.getByText("Showing settings")).toBeTruthy();
    });
  });

  describe("when the hash names no tab", () => {
    /** @scenario "A hash that names no tab leaves the console's own choice open" */
    it("keeps the console's own tab", () => {
      window.history.replaceState(null, "", "/#nothing");
      render(<Harness />);

      expect(screen.getByText("Showing calls")).toBeTruthy();
    });
  });

  describe("when there are no tabs", () => {
    it("draws no tab bar", () => {
      render(
        <SimConsole
          sim="mail"
          title="Mail"
          tabs={[]}
          activeTab=""
          onTab={() => undefined}
          status={{ tone: "warn", text: "Connecting" }}
        >
          <p>Inbox</p>
        </SimConsole>,
      );

      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.getByText("Inbox")).toBeTruthy();
    });
  });
});
