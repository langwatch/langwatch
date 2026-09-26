// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the activity reads have answered so far.
 *
 * Every field is nullable and `null` means the read has not answered — still in
 * flight, or never allowed to run because the viewer lacks the grant. It is
 * deliberately NOT collapsed to `0`/`[]`: this screen does not show a figure it
 * did not measure, and a zero is a measurement.
 */
export interface Breakdowns {
  departments: { id: string; name: string }[];
  departmentRows:
    | {
        departmentId: string | null;
        departmentName: string;
        spendUsd: string;
      }[]
    | null;
  userRows:
    | {
        actor: string;
        spendUsd: string;
        requests: number;
      }[]
    | null;
  activeUsers: number | null;
  /**
   * Model spend from the PULLED rollup, not from metered traces.
   *
   * Ranked rows rather than a bucket series because the panel is a ranked list:
   * it never drew the days, so carrying them here only meant re-totalling them
   * on every render. `amountUsd` is null when the figure is WITHHELD — some
   * cell behind that model holds no USD amount — which is not the same as zero
   * and must not be summed as one.
   */
  modelRows:
    | {
        model: string;
        amountUsd: number | null;
        cellsWithoutAmount: number;
      }[]
    | null;
  /**
   * Which of these reads FAILED, as opposed to answering nothing.
   *
   * Carried apart from the rows because every panel here renders an
   * unanswered read and an absent figure the same way, so a failed read would
   * otherwise land as a blank beside freshly filled neighbours and read as no
   * spend. `null` rows are what the panel draws its empty state from; this is
   * what stops it drawing one at all.
   */
  failed: {
    byDepartment: boolean;
    byUser: boolean;
    byModel: boolean;
  };
  /** Whether any of them is currently in flight, for the refresh control. */
  isFetching: boolean;
  /** Ask every one of them to run again. See the refresh control's comment. */
  refetchAll: () => void;
}
