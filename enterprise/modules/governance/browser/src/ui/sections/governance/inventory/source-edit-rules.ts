// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SourceType } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import { composerCadenceError } from "../../../../features/ingestion-sources/model/pull-cadence.ts";
import { isEditablePullSource } from "./source-submission.ts";

/**
 * Whether the backfill start has stopped being editable for this source.
 *
 * Only the USAGE cursor is one-way. The cost cursor binds `startingAt` into
 * its own identity, so moving the start mints a new identity, discards the
 * cursor and re-reads from the configured date — the deliberate repair lever
 * for a source whose early history is wrong (see `queryIdentity` and
 * `staleCursorRestart` in anthropicAdmin.puller.ts). Locking it for cost would
 * hide the one control that fixes those figures behind archive + recreate.
 *
 * A source that has never pulled holds no cursor to contradict, so nothing is
 * locked yet whatever the report.
 */
export function isBackfillStartLocked({
  hasPulled,
  report,
}: {
  hasPulled: boolean;
  report: string | undefined;
}): boolean {
  return hasPulled && report === "usage";
}

/**
 * Which adapter fields the form shows but refuses to change.
 *
 * `startingAt` locks because the usage cursor never rewinds, so an edited
 * start would be accepted and then ignored. `report` locks for a harder
 * reason: the two Anthropic reports price the same spend twice, the adapter
 * says "never both", and switching one that has already run leaves the old
 * report's events in place while the new one replays the same period beside
 * them. The service refuses that change too — this is the form declining to
 * offer what the server would reject, not the guarantee itself.
 */
export function lockedParserKeys({
  hasPulled,
  report,
  sourceType,
}: {
  hasPulled: boolean;
  report: string | undefined;
  sourceType?: SourceType;
}): string[] {
  const keys: string[] = [];
  if (isEnvironmentLocked({ hasPulled, sourceType })) keys.push("environmentUrl");
  if (isBackfillStartLocked({ hasPulled, report })) keys.push("startingAt");
  if (hasPulled && typeof report === "string" && report.length > 0) {
    keys.push("report");
  }
  return keys;
}

/**
 * What the edit drawer has to explain about settings the adapter can no longer
 * change, in the order it explains them.
 *
 * These were three paragraphs printed in the drawer body above the fields they
 * describe, which pushed the form below the fold on every source that had
 * pulled and were scrolled past by everyone who had read them once. They go
 * behind a (i) beside the title instead — the same place the create composer
 * already keeps its setup prose. See `dev/docs/best_practices/copywriting.md`.
 *
 * Empty for a source with nothing locked, and the header renders no marker at
 * all in that case: a (i) opening onto nothing is a promise of an explanation
 * that is not there.
 *
 * At most two ever apply. The report locks for any pulled source; of the other
 * two, the usage cursor never rewinds so its start is fixed, while the cost
 * cursor binds `startingAt` into its own identity so moving the start is the
 * deliberate repair lever for figures that are wrong. A fixed start and a
 * start worth moving are the two halves of one condition, and the report
 * decides which half this admin is looking at.
 */
export function editSourceNotes({
  hasPulled,
  report,
  sourceType,
}: {
  hasPulled: boolean;
  report: string | undefined;
  sourceType?: SourceType;
}): string[] {
  const notes: string[] = [];
  if (isEnvironmentLocked({ hasPulled, sourceType })) {
    notes.push(
      "The environment is fixed once a source has read conversations from it. To read another environment, archive this source and create a new one.",
    );
  }
  if (lockedParserKeys({ hasPulled, report }).includes("report")) {
    notes.push(
      "The report is fixed once a source has pulled: usage and cost describe the same spend, so recording both for one source would count it twice. To switch, archive this source and create a new one.",
    );
  }
  if (isBackfillStartLocked({ hasPulled, report })) {
    notes.push(
      "The start date is fixed once a source has pulled: the cursor has already moved past it and never rewinds. To re-read older data, archive this source and create a new one with an earlier start.",
    );
  }
  if (hasPulled && report === "cost") {
    notes.push(
      "Moving the start date re-reads cost history from the new date and restates the figures already recorded for that window.",
    );
  }
  return notes;
}

/** A conversation source's cursor is a position in one environment's history. */
function isEnvironmentLocked({
  hasPulled,
  sourceType,
}: {
  hasPulled: boolean;
  sourceType?: SourceType;
}): boolean {
  return hasPulled && sourceType === "copilot_studio_dataverse";
}

/**
 * Whether Save should refuse the click.
 *
 * The same two conditions the create drawer gates on, so the two cannot
 * disagree about what is worth submitting. The cadence half only applies to a
 * source whose adapter config this form rebuilds — a push-mode source has no
 * schedule for the field to have marked invalid.
 *
 * The server refuses an invalid cron regardless (`assertPullSchedule`, on the
 * update path), so this is not what keeps a bad schedule out of the column.
 * It is what stops the form submitting a value it has already told the admin
 * is wrong.
 */
export function isEditSaveBlocked({
  name,
  sourceType,
  pullSchedule,
}: {
  name: string;
  sourceType: SourceType | undefined;
  pullSchedule: string;
}): boolean {
  if (!name.trim()) return true;
  if (!isEditablePullSource(sourceType)) return false;
  return composerCadenceError({ sourceType, pullSchedule }) !== null;
}

/** Why Save is off, in words; `isEditSaveBlocked` keeps deciding whether it is. */
export function editSaveBlockedReason(input: {
  name: string;
  sourceType: SourceType | undefined;
  pullSchedule: string;
}): string | undefined {
  if (!input.name.trim()) return "Give the source a display name";
  if (isEditSaveBlocked(input)) return "Fix the pull schedule to save";
  return undefined;
}
