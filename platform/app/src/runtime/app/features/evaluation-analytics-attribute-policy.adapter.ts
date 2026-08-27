import { EvaluationAnalyticsAttributePolicy } from "@langwatch/evaluation-server";
import { trimAttributesForAnalytics } from "@langwatch/trace-server";

/** Adapts Trace's shared analytics retention policy for Evaluation's slim fold. */
export class TraceAnalyticsAttributePolicy extends EvaluationAnalyticsAttributePolicy {
  trim(attributes: Record<string, string>): Record<string, string> {
    return trimAttributesForAnalytics(attributes);
  }
}
