import { EvaluationAnalyticsAttributePolicy } from "@langwatch/evaluation-server/internal";

export class PreserveEvaluationAnalyticsAttributes extends EvaluationAnalyticsAttributePolicy {
  trim(attributes: Record<string, string>): Record<string, string> {
    return { ...attributes };
  }
}
