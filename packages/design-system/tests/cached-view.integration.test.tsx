// @vitest-environment jsdom
// Spec: packages/design-system/specs/cached-view.feature

import { Temporal } from "@langwatch/time";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CachedView } from "../src/components/cached-view.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

function at1042({ daysAgo }: { daysAgo: number }) {
  return Temporal.Now.zonedDateTimeISO()
    .subtract({ days: daysAgo })
    .with({ hour: 10, minute: 42, second: 0, millisecond: 0 })
    .toInstant();
}

function renderView(props: { confirmed: boolean; failed?: boolean; daysAgo?: number }) {
  renderWithDesignSystem(
    <CachedView
      asOf={at1042({ daysAgo: props.daysAgo ?? 0 })}
      confirmed={props.confirmed}
      {...(props.failed === undefined ? {} : { failed: props.failed })}
      data-testid="view"
    >
      <p>1,284 traces</p>
    </CachedView>,
  );
}

function dimmedContent(): HTMLElement {
  const wrapper = screen.getByText("1,284 traces").parentElement;
  if (!wrapper) throw new Error("the content has no wrapper");
  return wrapper;
}

describe("CachedView", () => {
  describe("given saved data the network has not confirmed", () => {
    /** @scenario "Saved data is dimmed and says when it is from" */
    it("dims the data, marks it busy and says when it is from", () => {
      renderView({ confirmed: false });

      expect(Number(getComputedStyle(dimmedContent()).opacity)).toBeLessThan(1);
      expect(screen.getByTestId("view").getAttribute("aria-busy")).toBe("true");
      expect(screen.getByRole("status").textContent).toBe("Showing data from 10:42 · updating");
    });
  });

  describe("given saved data the network has confirmed", () => {
    /** @scenario "Confirmed data is shown at full strength" */
    it("shows the data at full strength with no note", () => {
      renderView({ confirmed: true });

      expect(Number(getComputedStyle(dimmedContent()).opacity)).toBe(1);
      expect(screen.getByTestId("view").getAttribute("aria-busy")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  describe("given a refresh that did not answer", () => {
    /** @scenario "A refresh that did not answer says it could not refresh" */
    it("keeps the data dimmed and says it could not refresh", () => {
      renderView({ confirmed: false, failed: true });

      expect(Number(getComputedStyle(dimmedContent()).opacity)).toBeLessThan(1);
      expect(screen.getByTestId("view").getAttribute("aria-busy")).toBeNull();
      expect(screen.getByRole("status").textContent).toBe("From 10:42 · couldn't refresh");
    });
  });

  describe("given a copy from an earlier day", () => {
    /** @scenario "A copy from an earlier day names the day" */
    it("names the day as well as the time", () => {
      renderView({ confirmed: false, daysAgo: 3 });

      expect(screen.getByRole("status").textContent).toMatch(
        /^Showing data from [A-Z][a-z]{2} \d{1,2}, 10:42 · updating$/,
      );
    });
  });
});
