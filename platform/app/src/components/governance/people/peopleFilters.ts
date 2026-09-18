/**
 * The People page's filter state, and the one translation it has to make.
 *
 * Every choice lives in the address so a view is deep-linkable, and the default
 * of each stays out of it — the same rule the sort already followed
 * (`useSpendSortParam`).
 *
 * THE TRANSLATION. The section's time chips are named spans (`last_12_months`),
 * but the per-person spend read takes a window in days and refuses more than a
 * year. `spendWindowDays` maps the frame through the kit's own `frameSpanDays`
 * and clamps it at the read's ceiling, so picking "Last 2 years" reads a year
 * rather than failing validation. The clamp is visible rather than hidden: the
 * page says which window it actually read.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */

import { useSearchParams } from "react-router";

import {
  DEFAULT_TIME_FRAME,
  frameSpanDays,
  TIME_FRAMES,
  type TimeFrame,
} from "~/components/governance/filters";

/** The longest window `activityMonitor.spendByUser` accepts, in days. */
export const SPEND_WINDOW_MAX_DAYS = 365;

const isTimeFrame = (value: unknown): value is TimeFrame =>
  TIME_FRAMES.some((option) => option.value === value);

/**
 * The window the spend read is asked for, given the frame in view. Never wider
 * than the read accepts, and never narrower than a day.
 */
export function spendWindowDays({
  frame,
  now = new Date(),
}: {
  frame: TimeFrame;
  now?: Date;
}): number {
  const span = frameSpanDays({ frame, now });
  return Math.max(1, Math.min(SPEND_WINDOW_MAX_DAYS, span));
}

/** Whether the frame in view is longer than the spend read could answer. */
export function isFrameClamped({
  frame,
  now = new Date(),
}: {
  frame: TimeFrame;
  now?: Date;
}): boolean {
  return frameSpanDays({ frame, now }) > SPEND_WINDOW_MAX_DAYS;
}

export interface PeopleFilters {
  frame: TimeFrame;
  /** `null` is every department, including the people who have none. */
  department: string | null;
  setFrame: (next: TimeFrame) => void;
  setDepartment: (next: string | null) => void;
}

/**
 * Frame and department, read from and written to the address. The sort keeps
 * its own hook because the detail listing page shares it.
 */
export function usePeopleFilters(): PeopleFilters {
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedFrame = searchParams.get("frame");
  const frame: TimeFrame = isTimeFrame(requestedFrame)
    ? requestedFrame
    : DEFAULT_TIME_FRAME;
  const department = searchParams.get("department");

  const write = (key: string, value: string | null, fallback: string) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (value === null || value === fallback) params.delete(key);
        else params.set(key, value);
        return params;
      },
      { replace: true },
    );

  return {
    frame,
    department,
    setFrame: (next) => write("frame", next, DEFAULT_TIME_FRAME),
    setDepartment: (next) => write("department", next, ""),
  };
}
