/** Holds a relative date window stable for the current route address. */

import { nowInstant, toDate } from "@langwatch/time";
import { useMemo } from "react";
import { readAnnotationPeriod, type AnnotationPeriodReading } from "../model/annotation-period.ts";

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
        now: toDate(nowInstant()),
      }),
    [named, start, end],
  );
}
