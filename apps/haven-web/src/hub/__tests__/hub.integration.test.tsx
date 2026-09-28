// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubDaemon } from "../../__fixtures__/daemon-fetch.ts";
import { hub, logs } from "../../__fixtures__/daemon.ts";
import { App } from "../../app.tsx";
import { msOf } from "../../shared/clock.ts";

const NOW = msOf({ iso: "2026-09-28T12:00:00Z" });

const serveHub = () =>
  stubDaemon({
    answer: ({ path }) => {
      if (path === "/api/hub") return { body: hub({ now: NOW }) };
      if (path.startsWith("/api/logs?")) {
        const lane = new URLSearchParams(path.split("?")[1]).get("service") ?? "";
        return { body: logs({ now: NOW, lane }) };
      }
      return undefined;
    },
  });

const openAt = async ({ path }: { path: string }) => {
  window.history.replaceState(null, "", path);
  render(<App />);
};

const severityBoxes = () =>
  within(screen.getByRole("group", { name: "Severity" }))
    .getAllByRole("checkbox")
    .map((box) => box.closest("label")?.textContent ?? "");

describe("the hub", () => {
  beforeEach(() => serveHub());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("when the overview renders", () => {
    /** @scenario "The web dashboard shows the same machine picture" */
    it("shows the memory chart, idle worktrees and reaping, and states the shared servers once", async () => {
      await openAt({ path: "/" });
      await screen.findByRole("heading", { name: "Stacks" });

      expect(screen.getByRole("meter", { name: "Dev work" })).toBeDefined();
      expect(screen.getByRole("meter", { name: "Everything else" })).toBeDefined();
      expect(screen.getByRole("table", { name: "Worktrees with nothing running" })).toBeDefined();
      expect(screen.getByRole("table", { name: "Recent reaping" })).toBeDefined();
      expect(screen.getAllByText(/^Shared by every stack:/)).toHaveLength(1);

      const card = screen.getByRole("table", { name: "feat-x surfaces" });
      const names = within(card)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[1]?.textContent);
      expect(names).not.toContain("observability");
      expect(names).not.toContain("clickhouse");
      expect(screen.getByRole("link", { name: "feat-x" }).getAttribute("href")).toBe(
        "https://feat-x.langwatch.localhost",
      );
    });
  });

  describe("when the log view draws its severity control", () => {
    /** @scenario "Severity is a row of counted chips, not a dropdown of floors" */
    it("shows one counted chip per severity, worst first, and switching one off keeps its count", async () => {
      await openAt({ path: "/logs/feat-x" });
      await screen.findByRole("checkbox", { name: /^fatal/ });

      expect(severityBoxes()).toEqual([
        "fatal 6",
        "error 6",
        "warn 6",
        "info 30",
        "debug 6",
        "other 6",
      ]);
      const log = screen.getByRole("log", { name: "Captured service logs" });
      expect(within(log).getAllByText(/vite ready/).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("checkbox", { name: /^info/ }));

      expect(within(log).queryAllByText(/vite ready/)).toHaveLength(0);
      expect(severityBoxes()).toContain("info 30");
      expect(screen.getByText(/hiding info/)).toBeDefined();
    });
  });

  describe("when a filter matches inside a line", () => {
    /** @scenario "A search says where it matched, not only which lines it kept" */
    it("marks the matching text and writes captured markup as characters", async () => {
      await openAt({ path: "/logs/feat-x" });
      const filter = await screen.findByRole("searchbox", { name: "Filter" });
      const log = screen.getByRole("log", { name: "Captured service logs" });

      fireEvent.change(filter, { target: { value: "request" } });
      const marks = within(log).getAllByText("request", { selector: "mark" });
      expect(marks.length).toBeGreaterThan(0);

      fireEvent.change(filter, { target: { value: "script" } });
      expect(log.querySelector("script")).toBeNull();
      expect(log.textContent).toContain("<script>alert(1)</script>");
      expect(within(log).getAllByText("script", { selector: "mark" }).length).toBeGreaterThan(0);
    });
  });

  describe("when a developer presses slash", () => {
    /** @scenario "The log viewer is driven from the keyboard" */
    it("opens the log filter from anywhere, escape clears it, and it stands down while typing", async () => {
      await openAt({ path: "/" });
      await screen.findByRole("heading", { name: "Stacks" });

      await act(async () => {
        fireEvent.keyDown(document, { key: "/" });
      });
      const filter = await screen.findByRole("searchbox", { name: "Filter" });
      expect(window.location.pathname).toBe("/logs");
      expect(document.activeElement).toBe(filter);

      fireEvent.change(filter, { target: { value: "redis" } });
      const typed = fireEvent.keyDown(filter, { key: "/" });
      expect(typed).toBe(true);

      fireEvent.keyDown(filter, { key: "Escape" });
      expect(filter).toHaveProperty("value", "");
      expect(document.activeElement).toBe(filter);
      fireEvent.keyDown(filter, { key: "Escape" });
      expect(document.activeElement).not.toBe(filter);
    });
  });

  describe("when a lane's log link is followed", () => {
    it("reads only that lane of that stack", async () => {
      const daemon = serveHub();
      await openAt({ path: "/logs/feat-x/api" });
      await screen.findByRole("checkbox", { name: /^error/ });

      expect(daemon.calls.map((call) => call.path)).toContain("/api/logs?stack=feat-x&service=api");
    });
  });
});
