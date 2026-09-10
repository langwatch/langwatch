import { EvaluationAnalyticsAttributePolicy } from "../../../app/evaluation.members.ts";

export class PreserveEvaluationAnalyticsAttributes implements EvaluationAnalyticsAttributePolicy {
  trim(attributes: Record<string, string>): Record<string, string> {
    return { ...attributes };
  }
}
