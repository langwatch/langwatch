// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type TimeFrame, type TimeInterval } from "./time-controls.ts";

export interface CostFilters {
  department: string;
  /**
   * Carried alongside the id rather than looked up from the response. The
   * options come from the window being viewed, so a lookup has nothing to find
   * the moment the window changes, and the chip would name a department the
   * screen is no longer filtering by — or worse, name all of them.
   */
  departmentName: string | null;
  frame: TimeFrame;
  interval: TimeInterval;
}
