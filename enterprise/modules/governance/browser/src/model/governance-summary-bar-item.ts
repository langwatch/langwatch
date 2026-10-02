// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ReactNode } from "react";

export interface GovernanceSummaryBarItem {
  /** Stable across renders. The React key, and nothing else reads it. */
  key: string;
  /**
   * The figure, formatted by the caller. Null or undefined when the read held
   * nothing, which draws GOVERNANCE_SUMMARY_UNMEASURED.
   */
  value: ReactNode;
  /**
   * What the figure counts, in the reader's own words and never abbreviated:
   * "requests", not "req"; "tokens", not "tok".
   */
  label: string;
  /** One shorter line beneath the pair. Omitted rather than padded. */
  hint?: ReactNode;
  /** A small glyph above the figure, saying what kind of thing it counts. */
  icon?: ReactNode;
}
