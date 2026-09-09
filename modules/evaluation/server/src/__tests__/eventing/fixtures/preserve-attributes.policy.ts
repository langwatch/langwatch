import { EvaluationAnalyticsAttributePolicy } from "../../../ports/evaluation.port.ts";

export class PreserveEvaluationAnalyticsAttributes extends EvaluationAnalyticsAttributePolicy {
  trim(attributes: Record<string, string>): Record<string, string> {
    return { ...attributes };
  }
}
