// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { StateProjectionStore } from "@langwatch/eventing";

import type { ProjectWeekState, UserWeekState } from "../rules/digest-week.rules.ts";

type WeekReads<State> = Readonly<{
  listWeeks(input: { isoWeeks: readonly string[]; organizationId?: string }): Promise<State[]>;
  /** Drops every week older than the one named; answers how many rows went. */
  deleteBefore(input: { isoWeek: string }): Promise<number>;
}>;

/** A project's folded weeks: the projection store, and the reads the send and gallery make. */
export type DigestProjectWeekRepository = StateProjectionStore<ProjectWeekState> &
  WeekReads<ProjectWeekState>;

/** A person's folded coding-agent weeks. */
export type DigestUserWeekRepository = StateProjectionStore<UserWeekState> &
  WeekReads<UserWeekState>;
