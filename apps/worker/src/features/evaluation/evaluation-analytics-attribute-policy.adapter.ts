import { EvaluationAnalyticsAttributePolicy } from "@langwatch/evaluation-server";
import { trimAttributesForAnalytics } from "@langwatch/trace-server";

/**
 * Adapts Trace's shared analytics retention policy for Evaluation's slim fold.
 *
 * It lives beside the worker's Evaluation installer rather than inside either
 * feature package because it is the JOIN between two of them: Evaluation owns
 * the port and Trace owns the trimming rule, and neither package may depend on
 * the other to state it. Moved here verbatim from the application, which is
 * where the same join used to be made.
 */
export class TraceAnalyticsAttributePolicy extends EvaluationAnalyticsAttributePolicy {
  trim(attributes: Record<string, string>): Record<string, string> {
    return trimAttributesForAnalytics(attributes);
  }
}
