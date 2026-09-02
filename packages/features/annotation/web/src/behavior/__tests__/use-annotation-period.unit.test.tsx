/**
 * @vitest-environment jsdom
 *
 * The window a list is reading has to stay STILL between renders.
 *
 * A REGRESSION PIN for the defect the move introduced and the list suite found.
 * `readAnnotationPeriod` is pure and takes `now`, which is what makes it
 * testable; calling it straight out of a render body gave a relative range a
 * new end timestamp every render. Everything keyed on the window then moved
 * with it — the list's "the picks belong to these rows" effect set state, which
 * rendered, which moved the window again — and the queue read's tRPC input
 * carries the two dates, so in a browser every frame would also have been a
 * round trip on a fresh cache key.
 *
 * The assertion is referential, not structural: two windows that are EQUAL are
 * not enough, because a new pair of Date objects with the same milliseconds
 * still busts every dependency array they reach.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAnnotationPeriod } from "../use-annotation-period";
import type { AnnotationPeriodReading } from "../../model/annotation-period";

function Probe({
  query,
  seen,
}: {
  query: Record<string, string | undefined>;
  seen: AnnotationPeriodReading[];
}) {
  seen.push(useAnnotationPeriod(query));
  return null;
}

describe("given a list reading a relative range off the address", () => {
  describe("when it renders again on the same address", () => {
    it("hands back the same window object rather than re-anchoring it to now", () => {
      const seen: AnnotationPeriodReading[] = [];
      const view = render(<Probe query={{ period: "30d" }} seen={seen} />);

      // A new object literal for the query, which is what a route port hands
      // back on every read — the window must not move because of it.
      view.rerender(<Probe query={{ period: "30d" }} seen={seen} />);
      view.rerender(<Probe query={{ period: "30d" }} seen={seen} />);

      expect(seen.length).toBeGreaterThanOrEqual(3);
      expect(seen[1]!.period).toBe(seen[0]!.period);
      expect(seen[2]!.period).toBe(seen[0]!.period);
      expect(seen[0]!.isDefault).toBe(false);
    });
  });

  describe("when the reviewer picks a different range", () => {
    it("moves the window, because that is the one thing that should move it", () => {
      const seen: AnnotationPeriodReading[] = [];
      const view = render(<Probe query={{ period: "30d" }} seen={seen} />);

      view.rerender(<Probe query={{ period: "7d" }} seen={seen} />);

      const before = seen[0]!.period;
      const after = seen.at(-1)!.period;
      expect(after).not.toBe(before);
      expect(after.startDate.getTime()).toBeGreaterThan(before.startDate.getTime());
    });
  });

  describe("when the address carries no range at all", () => {
    it("still holds the fallback window still", () => {
      const seen: AnnotationPeriodReading[] = [];
      const view = render(<Probe query={{}} seen={seen} />);

      view.rerender(<Probe query={{}} seen={seen} />);

      expect(seen.at(-1)!.period).toBe(seen[0]!.period);
      expect(seen[0]!.isDefault).toBe(true);
    });
  });
});
