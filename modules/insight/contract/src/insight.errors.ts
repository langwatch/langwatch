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
