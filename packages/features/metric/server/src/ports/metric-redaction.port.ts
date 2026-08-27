import type { MetricPiiRedactionLevel } from "@langwatch/metric-contract";

/** Private redaction dependency for metric preparation. */
export abstract class MetricRedactionPort {
  abstract redactMetricAttributes(
    input: {
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
      attributeNames?: Record<string, string>;
    },
    level: MetricPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
}
