import { z } from "zod";

/** Portable graph-alert threshold vocabulary shared by authoring and dispatch. */
export const GRAPH_ALERT_OPERATORS = ["gt", "lt", "gte", "lte", "eq"] as const;
export type GraphAlertOperator = (typeof GRAPH_ALERT_OPERATORS)[number];

/** Time windows offered by the graph-alert authoring flow (minutes). */
export const GRAPH_ALERT_TIME_PERIODS = [1, 5, 15, 30, 60, 1440] as const;
export type GraphAlertTimePeriod = (typeof GRAPH_ALERT_TIME_PERIODS)[number];

export type CustomGraphOperator = GraphAlertOperator;

const EQ_EPSILON = 0.0001;

/** Pure threshold evaluation shared by event and heartbeat dispatch paths. */
export function evaluateCustomGraphThreshold({
  value,
  threshold,
  operator,
}: {
  value: number;
  threshold: number;
  operator: string;
}): { breached: boolean } {
  switch (operator) {
    case "gt":
      return { breached: value > threshold };
    case "gte":
      return { breached: value >= threshold };
    case "lt":
      return { breached: value < threshold };
    case "lte":
      return { breached: value <= threshold };
    case "eq":
      return { breached: Math.abs(value - threshold) < EQ_EPSILON };
    default:
      return { breached: false };
  }
}

/** Whether a threshold breaches on total silence (zero current value). */
export function isNoDataPredicate({
  operator,
  threshold,
}: {
  operator: string;
  threshold: number;
}): boolean {
  return evaluateCustomGraphThreshold({ value: 0, threshold, operator }).breached;
}

/** Parse the watched series index from `<index>/<key>/<aggregation>`. */
export function parseSeriesIndex(seriesName?: string | null): number {
  if (!seriesName) return 0;
  const [indexStr] = seriesName.split("/");
  return Number.parseInt(indexStr ?? "0", 10);
}

export const graphSeriesCollectionSchema = z
  .object({
    series: z.array(
      z
        .object({
          key: z.string().optional(),
          metric: z.string().optional(),
          aggregation: z.string().optional(),
          name: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** The persisted series key for a graph alert: `<index>/<metric>/<aggregation>`. */
export function deriveSeriesIdentifier(graph: unknown, index: number): string | undefined {
  const parsed = graphSeriesCollectionSchema.safeParse(graph);
  if (!parsed.success) {
    return void 0;
  }

  const entry = parsed.data.series[index];
  if (entry === void 0) {
    return void 0;
  }

  let keyPart = "value";
  if (entry.key && entry.key.length > 0) {
    keyPart = entry.key;
  } else if (entry.metric) {
    keyPart = entry.metric;
  }

  const aggregationPart = entry.aggregation ?? "count";
  return `${index}/${keyPart}/${aggregationPart}`;
}

export const graphAlertOperatorSchema = z.enum(GRAPH_ALERT_OPERATORS);
export const graphAlertTimePeriodSchema = z.union([
  z.literal(1),
  z.literal(5),
  z.literal(15),
  z.literal(30),
  z.literal(60),
  z.literal(1440),
]);

/** Threshold fields are independent of the destination provider fields. */
export const graphAlertActionParamsSchema = z.object({
  threshold: z.number().finite(),
  operator: graphAlertOperatorSchema,
  timePeriod: graphAlertTimePeriodSchema,
  seriesName: z.string().min(1, "Pick a series to monitor."),
});

export type GraphAlertActionParams = z.infer<typeof graphAlertActionParamsSchema>;

export type BuildGraphAlertTriggerDataInput = {
  id: string;
  name: string;
  projectId: string;
  action: "SEND_EMAIL" | "SEND_SLACK_MESSAGE" | "SEND_WEBHOOK";
  alertType: "CRITICAL" | "WARNING" | "INFO";
  customGraphId: string;
  actionParams: GraphAlertActionParams & Record<string, unknown>;
};

export type GraphAlertTriggerData = {
  id: string;
  name: string;
  projectId: string;
  action: BuildGraphAlertTriggerDataInput["action"];
  actionParams: Record<string, unknown>;
  filters: Record<string, never>;
  alertType: BuildGraphAlertTriggerDataInput["alertType"];
  active: true;
  customGraphId: string;
};

/** Event/heartbeat reason carried through the singular AutomationService. */
export type GraphTriggerEvaluationReason = "real-time" | "heartbeat-absence" | "heartbeat-resolve";

export type GraphTriggerEvaluationStatus =
  | "fired"
  | "already_firing"
  | "resolved"
  | "not_breached"
  | "skipped"
  | "not_delivered";

export type GraphTriggerEvaluationResult = {
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
  status: GraphTriggerEvaluationStatus;
  detail?: string;
  value?: number;
  didSend?: boolean;
  renderErrors?: string[];
  missingVariables?: string[];
};

/** Heartbeat decisions are returned to the Eventing scheduler for dispatch. */
export type GraphTriggerSweepCandidate = {
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
};

/** Portable writer for the single graph-alert trigger row shape. */
export function buildGraphAlertTriggerData({
  id,
  name,
  projectId,
  action,
  alertType,
  customGraphId,
  actionParams,
}: BuildGraphAlertTriggerDataInput): GraphAlertTriggerData {
  return {
    id,
    name: name.replace(/^\s*alert:\s*/i, "").trim(),
    projectId,
    action,
    actionParams: { ...actionParams },
    filters: {},
    alertType,
    active: true,
    customGraphId,
  };
}

/** Parses an existing row while preserving provider destination keys. */
export function extractGraphAlertFromTriggerRow(
  actionParams: unknown,
): (GraphAlertActionParams & Record<string, unknown>) | null {
  if (typeof actionParams !== "object" || actionParams === null) return null;
  const parsed = graphAlertActionParamsSchema.safeParse(actionParams);
  if (!parsed.success) return null;
  return {
    ...(actionParams as Record<string, unknown>),
    ...parsed.data,
  };
}
