import { type EvaluationAnalyticsAttributePolicy } from "@langwatch/evaluation-server";
import { trimAttributesForAnalytics } from "@langwatch/trace-server";

/**
 * Adapts Trace's shared analytics retention policy for Evaluation. Lives here
 * because it's the JOIN between two feature packages that cannot depend on each other.
 */
export class TraceAnalyticsAttributePolicy implements EvaluationAnalyticsAttributePolicy {
  trim(attributes: Record<string, string>): Record<string, string> {
    return trimAttributesForAnalytics(attributes);
  }
}
