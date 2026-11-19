// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { StateProjectionStore } from "@langwatch/eventing";

import type { ProjectWeekState, UserWeekState } from "../rules/digest-week.rules.ts";

/** The reads the send and gallery make over one kind of folded week. */
export interface DigestWeekReadRepository<State> {
  /** One organization's folds for these weeks: a read never spans organizations. */
  findWeeks(input: { isoWeeks: readonly string[]; organizationId: string }): Promise<State[]>;
  /** Drops every week older than the one named; answers how many rows went. */
  deleteBefore(input: { isoWeek: string }): Promise<number>;
}

/** A project's folded weeks: the projection store, and its week reads. */
export type DigestProjectWeekRepository = StateProjectionStore<ProjectWeekState> &
  DigestWeekReadRepository<ProjectWeekState>;

/** A person's folded coding-agent weeks. */
export type DigestUserWeekRepository = StateProjectionStore<UserWeekState> &
  DigestWeekReadRepository<UserWeekState>;
