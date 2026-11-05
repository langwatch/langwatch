/**
 * @vitest-environment jsdom
 * The rule insight lends the side menu and uses for its bell: when either shows at all.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InsightHostProvider } from "../../model/insight-host.ts";
import { StubInsightHost, type StubInsightHostOptions } from "../../testing.tsx";
import { insightsEntry } from "../use-insights-shown.ts";

/** Stands in for the side menu: it asks the lent rule, as navigation does. */
function EntryReader() {
  return <span data-testid="shown">{String(insightsEntry.useIsShown())}</span>;
}

function shownFor(options: StubInsightHostOptions): string | null {
  render(
    <InsightHostProvider value={new StubInsightHost(options)}>
      <EntryReader />
    </InsightHostProvider>,
  );
  return screen.getByTestId("shown").textContent;
}

afterEach(cleanup);

describe("given a member with analytics:view on an application project", () => {
  describe("when both release flags are on", () => {
    it("shows the entry", () => {
      expect(shownFor({ enabled: true })).toBe("true");
    });
  });

  describe("when a flag is off or still loading, or the grant is missing", () => {
    /** @scenario "The side menu shows no Insights entry while the flag is off" */
    it.each([
      { case: "a flag is off", options: { enabled: false } },
      { case: "a flag is still loading", options: { enabled: undefined } },
      { case: "the member lacks analytics:view", options: { enabled: true, permissions: [] } },
      { case: "no project is in scope", options: { enabled: true, project: undefined } },
    ])("hides the entry when $case", ({ options }) => {
      expect(shownFor(options)).toBe("false");
    });
  });
});

describe("given an aggregate project, which files no insight", () => {
  /** @scenario "An aggregate project's side menu holds no Insights entry" */
  it("hides the entry", () => {
    expect(
      shownFor({ enabled: true, project: { id: "project-1", slug: "acme", kind: "aggregate" } }),
    ).toBe("false");
  });
});
