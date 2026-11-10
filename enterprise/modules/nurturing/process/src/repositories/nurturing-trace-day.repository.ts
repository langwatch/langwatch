// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldProjectionStore } from "@langwatch/eventing";

import type { NurturingTraceDayState } from "../rules/nurturing-trace-day.rules.ts";

/** The trace-day fold's version; a stored row of another version is left out of every read. */
export const NURTURING_TRACE_DAY_PROJECTION_VERSION = "2026-11-10" as const;

/** The fold's key: one row per project and UTC day. */
export function traceDayKey({ projectId, day }: Readonly<{ projectId: string; day: string }>) {
  return `${projectId}:${day}`;
}

/** The project and day a fold key names; the day, `YYYY-MM-DD`, never holds a colon. */
export function traceDayOfKey(key: string): Readonly<{ projectId: string; day: string }> {
  const split = key.lastIndexOf(":");
  return { projectId: key.slice(0, split), day: key.slice(split + 1) };
}

/** Nurturing's per-project, per-day trace counts: the fold's store, its read and its retention. */
export interface NurturingTraceDayRepository {
  /** The fold's store; its rows are keyed {@link traceDayKey}. */
  readonly store: FoldProjectionStore<NurturingTraceDayState>;
  /** The projects' days after `afterDay`, of the current version. */
  findForProjects(
    input: Readonly<{ projectIds: readonly string[]; afterDay: string }>,
  ): Promise<NurturingTraceDayState[]>;
  /** Drops the projects' days before `beforeDay`: no read reaches them any more. */
  pruneBefore(input: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void>;
}
