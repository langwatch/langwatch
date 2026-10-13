// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type GovernanceCostSummary } from "@langwatch/enterprise-governance-contract";

import { type Breakdowns } from "./breakdowns.ts";
import { type CostFilters } from "./cost-filters.ts";
import { summaryAsRead } from "./cost-sample-mode.ts";
import { ALL_DEPARTMENTS } from "./costs-window.ts";
import { type RankRow } from "./sample-series.ts";

/**
 * The ranked model list's key for rows the provider named no model on.
 *
 * A key of its own rather than the empty string: the list keys its rows, and
 * "" is falsy in enough of the places a key travels through that a row with
 * one is a bug waiting for a re-render. The LABEL beside it says no model was
 * named rather than inventing one, the same honesty the spender panel's
 * not-named bucket keeps.
 */
const UNNAMED_MODEL_KEY = "__no_model__";

/** The four measured series the grid draws. Null is an unanswered read. */
export interface MeasuredRows {
  byDepartment: RankRow[] | null;
  byModel: RankRow[] | null;
  byUser: RankRow[] | null;
}

/**
 * The wire rows, folded to the interval and narrowed by the department chip.
 *
 * Null carries all the way through: an unanswered read stays unanswered rather
 * than turning into an empty list, which the panel would report as a
 * measurement of an empty window.
 */
export function measuredRows({
  breakdowns,
  filters,
}: {
  breakdowns: Breakdowns;
  filters: CostFilters;
}): MeasuredRows {
  return {
    byDepartment:
      breakdowns.departmentRows === null
        ? null
        : breakdowns.departmentRows
            .filter(
              (row) =>
                filters.department === ALL_DEPARTMENTS ||
                (row.departmentId ?? "unassigned") === filters.department,
            )
            .map((row) => ({
              key: row.departmentId ?? "unassigned",
              label: row.departmentName,
              value: Number(row.spendUsd),
            })),
    // Already totalled by the service. A model the provider named nothing
    // for keeps an honest label rather than an invented one, the same choice
    // the spender panel makes for its not-named bucket.
    //
    // A WITHHELD figure is LISTED, not dropped. The money was billed, so a
    // list that leaves the model out reports a smaller bill than the provider
    // sent — and a window whose models were all withheld emptied the panel
    // into "nothing in this window yet", which claims a measurement the
    // screen does not have. It carries a stand-in zero and the flag that says
    // so: `CostRankList` draws no bar for it and prints no figure, and the
    // cells-without-amount count is what its hover explains it with.
    byModel:
      breakdowns.modelRows === null
        ? null
        : breakdowns.modelRows.map((row) => ({
            key: row.model === "" ? UNNAMED_MODEL_KEY : row.model,
            label: row.model === "" ? "No model named" : row.model,
            value: row.amountUsd ?? 0,
            unpriced: row.amountUsd === null,
            unpricedCells: row.cellsWithoutAmount,
          })),
    byUser:
      breakdowns.userRows === null
        ? null
        : breakdowns.userRows.map((row) => ({
            key: row.actor,
            label: row.actor,
            value: Number(row.spendUsd),
          })),
  };
}

/**
 * Adoption: how far AI tools have reached into the organization.
 *
 * Only the active-user count is measured today. In sample mode the panel shows
 * the four figures it is meant to hold rather than the word "Not available",
 * which named nothing and told the reader nothing about what would fill it.
 *
 * An interaction count used to sit beside the user count, summed from the
 * ranked user rows — but that read is a top-8, so the sum was the leaders'
 * share wearing the name of an organization-wide total. It is gone rather than
 * quietly wrong.
 */
/**
 * Whether any source is reporting, which is what the lanes and the adoption
 * count both need and neither should decide for itself.
 *
 * "Holds figures", not merely "answered". A read that came back with every
 * lane empty leaves the same blank screen a failed one does, and an
 * organization with a cost store configured but nothing flowing through it
 * answers exactly that way: `unavailableReason` null, every lane empty. The
 * structural reasons are the OTHER half — no governance project, no cost store
 * — and `summaryAsRead` already folds both into one length.
 *
 * The adoption headcount needs this because it is the one number on this page
 * that CANNOT state its own absence: the activity summary types
 * `activeUsersThisWindow` as a plain number and zero-fills it when nothing is
 * behind it, so "nobody used a tool" and "nothing is connected" arrive as the
 * same 0. The tempting fix — treat every 0 as unmeasured — is wrong the other
 * way: an organization with a source connected and a genuinely quiet quarter
 * has a true zero, and that IS the finding. So the question asked is
 * CONNECTEDNESS, never the count.
 *
 * One function rather than two because the lanes asked this first and the
 * screen has to agree with itself. It was the second, weaker copy of this test
 * — `unavailableReason` alone — that let the adoption card print "0" directly
 * beneath the page's own banner saying nothing had been recorded.
 */
// A type predicate rather than a plain boolean: holding figures implies the
// read answered, and the lane branch below draws from `data` on the strength of
// exactly that. Written as `boolean` it compiled everywhere except there.
export function summaryHoldsFigures(
  data: GovernanceCostSummary | undefined,
  isError: boolean,
): data is GovernanceCostSummary {
  return (
    !!data && !isError && data.unavailableReason === null && (summaryAsRead(data)?.length ?? 0) > 0
  );
}
