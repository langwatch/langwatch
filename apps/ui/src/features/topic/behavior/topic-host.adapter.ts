/**
 * The topic package's host port, answered from this application.
 *
 * `@langwatch/topic-web` declares what its screen needs — the project in scope
 * and the two notices — as one abstract class it can define without importing
 * anything of ours. This is the other half: a plain adapter over what the
 * application shell has already resolved.
 *
 * NOTHING HERE FETCHES. The values arrive as arguments, so the adapter is a
 * value object a test can construct.
 */

import {
  TopicHostPort,
  type TopicFailureNotice,
  type TopicHostProject,
  type TopicSuccessNotice,
} from "@langwatch/topic-web/screens/topic-clustering";

/** The grant the platform page asked for, unchanged. */
export const TOPIC_CLUSTERING_PAGE_PERMISSION = "project:manage";

export type TopicHostReadings = {
  project: TopicHostProject | undefined;
};

export type TopicHostActions = {
  succeeded: (notice: TopicSuccessNotice) => void;
  failed: (failure: TopicFailureNotice) => void;
};

export class UiTopicHost extends TopicHostPort {
  static create(readings: TopicHostReadings, actions: TopicHostActions): UiTopicHost {
    return new UiTopicHost(readings, actions);
  }

  private constructor(
    private readonly readings: TopicHostReadings,
    private readonly actions: TopicHostActions,
  ) {
    super();
  }

  project(): TopicHostProject | undefined {
    return this.readings.project;
  }

  succeeded(notice: TopicSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: TopicFailureNotice): void {
    this.actions.failed(failure);
  }
}
