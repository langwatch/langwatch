// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { StateProjectionStore } from "@langwatch/eventing";

import type { ProjectWeekState, UserWeekState } from "../rules/digest-week.rules.ts";

/** The reads the send and gallery make over one kind of folded week. */
export interface DigestWeekReadRepository<State> {
  /** One organization's folds for these weeks: a read never spans organizations. */
  findWeeks(input: { isoWeeks: readonly string[]; organizationId: string }): Promise<State[]>;
  /** Drops every week older than the one named. */
  deleteBefore(input: { isoWeek: string }): Promise<void>;
}

/** A project's folded weeks: the projection store, and its week reads. */
export type DigestProjectWeekRepository = StateProjectionStore<ProjectWeekState> &
  DigestWeekReadRepository<ProjectWeekState>;

/** A person's folded coding-agent weeks. */
export type DigestUserWeekRepository = StateProjectionStore<UserWeekState> &
  DigestWeekReadRepository<UserWeekState> & {
    /** Deletes every week folded for the person, in every organization. */
    forgetUser(input: { userId: string }): Promise<void>;
  };
