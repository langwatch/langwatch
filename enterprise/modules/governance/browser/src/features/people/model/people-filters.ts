// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The People page's fixed spend window: half the rows come from the identity
 * feed, which has no window, so the page states one year in words rather than
 * offering a chip. Spec: specs/ai-governance/dashboard/people-tabs.feature
 */

/**
 * The window `activityMonitor.spendByUser` is asked for. A year, which is also
 * the longest that read accepts: governance is read at a governance cadence,
 * and the read refuses anything wider.
 */
export const SPEND_WINDOW_DAYS = 365;

/** How the page names that window to a reader. */
export const SPEND_WINDOW_LABEL = "last 12 months";
