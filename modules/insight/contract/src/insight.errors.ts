import { HandledError } from "@langwatch/handled-error";

/** An insight the project does not have, or one another person owns: the two answer alike. */
export class InsightNotFoundError extends HandledError {
  declare readonly code: "insight_not_found";

  constructor(readonly insightId: string) {
    super("insight_not_found", "Insight not found.", {
      httpStatus: 404,
      fault: "customer",
      meta: { insightId },
    });
    this.name = "InsightNotFoundError";
  }
}

/** An insights procedure called while `release_insights` is off for the project. */
export class InsightsNotEnabledError extends HandledError {
  declare readonly code: "insights_not_enabled";

  constructor() {
    super("insights_not_enabled", "Insights are not enabled for this project.", {
      httpStatus: 403,
    });
    this.name = "InsightsNotEnabledError";
  }
}

/** `runAction` called while `release_insight_actions` is off for the project. */
export class InsightActionsNotEnabledError extends HandledError {
  declare readonly code: "insight_actions_not_enabled";

  constructor() {
    super("insight_actions_not_enabled", "Insight actions are not enabled for this project.", {
      httpStatus: 403,
    });
    this.name = "InsightActionsNotEnabledError";
  }
}

/** An action id the insight does not have, though another insight may. */
export class InsightActionNotFoundError extends HandledError {
  declare readonly code: "insight_action_not_found";

  constructor(readonly actionId: string) {
    super("insight_action_not_found", "Insight action not found.", {
      httpStatus: 404,
      fault: "customer",
      meta: { actionId },
    });
    this.name = "InsightActionNotFoundError";
  }
}

/**
 * An action on an insight a run filed, or one saved from a run's conversation: that history
 * holds trace text nobody vetted, so nothing is sent on from it.
 */
export class InsightActionFromRunError extends HandledError {
  declare readonly code: "insight_action_from_run";

  constructor(readonly insightId: string) {
    super("insight_action_from_run", "Actions are not available on an insight from a run.", {
      httpStatus: 403,
      fault: "customer",
      meta: { insightId },
    });
    this.name = "InsightActionFromRunError";
  }
}
