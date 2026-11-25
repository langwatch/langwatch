// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

import userEvent from "@testing-library/user-event";
import { Pencil, ShieldCheck } from "lucide-react";

import { ActivityTimeline } from "../activity-timeline.tsx";

describe("ActivityTimeline", () => {
  /** @scenario "Activity is grouped by local day and sorted newest first" */
  it("sorts without mutating entries and groups across a local midnight", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    const entries = [
      { id: "old", occurredAtMs: Date.parse("2026-10-07T18:00:00Z"), content: "Claimed" },
      {
        id: "yesterday",
        occurredAtMs: Date.parse("2026-10-09T21:00:00Z"),
        content: "Verified",
        icon: <ShieldCheck size={14} />,
      },
      {
        id: "today",
        occurredAtMs: Date.parse("2026-10-09T22:30:00Z"),
        content: "Renamed",
        icon: <Pencil size={14} />,
      },
      { id: "newest", occurredAtMs: Date.parse("2026-10-10T11:00:00Z"), content: "Activated" },
    ];
    renderWithDesignSystem(
      <ActivityTimeline entries={entries} timeZone="Europe/Amsterdam" locale="en-US" />,
    );
    expect(screen.getByText("Newest first")).toBeVisible();
    expect(screen.getAllByRole("list").map((node) => node.getAttribute("aria-label"))).toEqual([
      "Today",
      "Yesterday",
      "Oct 7, 2026",
    ]);
    const today = within(screen.getByRole("list", { name: "Today" })).getAllByRole("listitem");
    expect(today[0]).toHaveTextContent("Activated");
    expect(today[1]).toHaveTextContent("Renamed");
    expect(today[1]?.querySelector("svg.lucide-pencil")).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Yesterday" }).querySelector("svg.lucide-shield-check"),
    ).toBeInTheDocument();
    expect(entries.map((entry) => entry.id)).toEqual(["old", "yesterday", "today", "newest"]);
  });

  /** @scenario "An empty timeline explains its state" */
  it("shows the supplied empty state without day groups", () => {
    renderWithDesignSystem(<ActivityTimeline entries={[]} emptyState="No changes recorded." />);
    expect(screen.getByText("No changes recorded.")).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  /** @scenario "Relative activity times expose the exact instant" */
  it("reveals the exact time on keyboard focus", async () => {
    const user = userEvent.setup();
    const occurredAtMs = Date.parse("2020-01-15T12:00:00Z");
    renderWithDesignSystem(
      <ActivityTimeline entries={[{ id: "one", occurredAtMs, content: "Created" }]} />,
    );
    const time = screen.getByRole("button", { name: /ago/ });
    expect(time.querySelector("time")).toHaveAttribute("datetime", "2020-01-15T12:00:00Z");
    await user.tab();
    expect(time).toHaveFocus();
    expect(
      await screen.findByRole("button", { name: "Copy ISO 8601: 2020-01-15T12:00:00Z" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: `Copy Unix ms: ${occurredAtMs}` })).toBeVisible();
  });
});
