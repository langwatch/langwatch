// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

import { type Breakdowns } from "../model/breakdowns.ts";
import { type CostFilters } from "../model/cost-filters.ts";
import { ALL_DEPARTMENTS } from "../model/costs-window.ts";
import {
  DEFAULT_TIME_FRAME,
  DEFAULT_TIME_INTERVAL,
  coerceInterval,
  type TimeFrame,
} from "../model/time-controls.ts";

/**
 * The screen's filter state, and the two ways it is allowed to change.
 *
 * The frame and the interval are not independent, which is why they move
 * together here rather than at the call site. Narrowing the frame can leave
 * the reader on an interval the new frame cannot draw — a quarter over three
 * months is one bar wearing a chart's clothes. `chooseFrame` steps down to the
 * widest interval that still fits, in one place so every governance page
 * answers alike.
 */
export function useCostFilters() {
  const [filters, setFilters] = useState<CostFilters>({
    department: ALL_DEPARTMENTS,
    departmentName: null,
    frame: DEFAULT_TIME_FRAME,
    interval: DEFAULT_TIME_INTERVAL,
  });
  const patch = (next: Partial<CostFilters>) => setFilters((current) => ({ ...current, ...next }));
  const chooseFrame = (frame: TimeFrame) =>
    patch({
      frame,
      interval: coerceInterval({ interval: filters.interval, frame }),
    });
  return { filters, setFilters, patch, chooseFrame };
}

/**
 * Drops a department selection the current window no longer contains.
 *
 * A window can answer without the department the reader is standing on: it
 * spent nothing over the shorter span, so it has no row and no option in the
 * picker. The selection would stay behind and filter every remaining row away,
 * leaving an empty panel under a chip that no longer had a name to show.
 * Clearing it is the only outcome where the label and the rows agree.
 *
 * Only an answered read counts. A read still in flight is not evidence that the
 * department is gone, and resetting on one would throw the reader's choice away
 * on every refetch.
 *
 * Sample mode is exempt: the sample departments are a fixed list that never
 * drops a name, and running the reset against the real reads while the reader
 * is looking at invented departments would clear a selection that is still on
 * screen.
 */
export function useDepartmentSelectionReset({
  filters,
  breakdowns,
  setFilters,
  showSample,
}: {
  filters: CostFilters;
  breakdowns: Breakdowns;
  setFilters: Dispatch<SetStateAction<CostFilters>>;
  showSample: boolean;
}) {
  const { departmentRows, departments } = breakdowns;
  const selected = filters.department;
  useEffect(() => {
    if (showSample) return;
    if (selected === ALL_DEPARTMENTS) return;
    if (departmentRows === null) return;
    if (departments.some((d) => d.id === selected)) return;
    setFilters((current) => ({
      ...current,
      department: ALL_DEPARTMENTS,
      departmentName: null,
    }));
  }, [selected, departmentRows, departments, setFilters, showSample]);
}
