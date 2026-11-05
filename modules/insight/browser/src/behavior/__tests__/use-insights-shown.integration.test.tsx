/**
 * @vitest-environment jsdom
 * The rule insight lends the side menu and uses for its bell: when either shows at all.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InsightHostProvider } from "../../model/insight-host.ts";
import { StubInsightHost, type StubInsightHostOptions } from "../../testing.tsx";
import { useInsightsShown } from "../use-insights-shown.ts";

function EntryReader() {
  return <span data-testid="shown">{String(useInsightsShown())}</span>;
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

const AGGREGATE = { id: "project-1", slug: "acme", kind: "aggregate" } as const;

describe("the rule, from a reader with every condition met", () => {
  it("shows (the positive control for the cases below)", () => {
    expect(shownFor({ enabled: true })).toBe("true");
  });

  /** @scenario "The side menu shows no Insights entry while the flag is off" */
  it.each([
    { case: "a flag is off", options: { enabled: false } },
    { case: "a flag is still loading", options: { enabled: undefined } },
    { case: "the member lacks analytics:view", options: { enabled: true, permissions: [] } },
    { case: "no project is in scope", options: { enabled: true, project: undefined } },
  ])("hides when only this changes: $case", ({ options }) => {
    expect(shownFor(options)).toBe("false");
  });

  /** @scenario "An aggregate project's side menu holds no Insights entry" */
  it("hides when only this changes: the project is an aggregate", () => {
    expect(shownFor({ enabled: true, project: AGGREGATE })).toBe("false");
  });
});
