/**
 * The date range a list is reading, held still between renders.
 *
 * `readAnnotationPeriod` is pure and takes `now`, which is what makes it
 * testable — and what makes calling it straight out of a render body a bug.
 * A relative range is anchored to the moment it is resolved, so a fresh `now`
 * per render is a fresh `endDate` per render, to the millisecond. Anything
 * downstream that is keyed on the window then changes on every render: the
 * list's "the picks belong to these rows" effect re-fires and sets state, which
 * renders, which moves the window again. That is an infinite loop, and in a
 * browser it is also an infinite round trip — the queue read's input carries
 * the two dates, so every render would be a new tRPC cache key.
 *
 * `platform/app`'s `usePeriodSelector` held the same line with the same
 * `useMemo`, and its comment said why: the window has to stay referentially
 * stable unless the ADDRESS changes. A page re-mount — a refresh, a route
 * change — gets a fresh `now` for free, which is the only time a relative
 * window should move.
 */

import { useMemo } from "react";
import { readAnnotationPeriod, type AnnotationPeriodReading } from "../model/annotation-period";

export function useAnnotationPeriod(
  query: Readonly<Record<string, string | undefined>>,
): AnnotationPeriodReading {
  const named = query.period;
  const start = query.startDate;
  const end = query.endDate;

  return useMemo(
    // Deliberately not in the dependency list: `now` is read once per address,
    // which is the whole point of holding the window still.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () =>
      readAnnotationPeriod({
        query: { period: named, startDate: start, endDate: end },
        now: new Date(),
      }),
    [named, start, end],
  );
}
