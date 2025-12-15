import type { Project, Trigger } from "@prisma/client";
import type { Trace } from "~/server/tracer/types";
import type {
  TRACE_EXPANSIONS,
  TraceMapping,
} from "~/server/tracer/tracesMapping";

export interface TraceGroups {
  groups: Trace[][];
}

export interface ActionParams {
  members?: string[] | null;
  dataset?: string | null;
  slackWebhook?: string | null;
  datasetMapping: {
    mapping: Record<string, { source: string; key: string; subkey: string }>;
    expansions: Set<keyof typeof TRACE_EXPANSIONS>;
  };
  datasetId: string;
  annotators?: { id: string; name: string }[];
  createdByUserId?: string;
  threshold?: number;
  operator?: string;
  timePeriod?: number;
}

export interface TriggerData {
  input: string;
  output: string;
  traceId?: string;
  graphId?: string;
  projectId: string;
  fullTrace: Trace;
}

export interface TriggerContext {
  trigger: Trigger;
  projects: Project[];
  triggerData: TriggerData[];
  projectSlug: string;
}

export interface TriggerResult {
  triggerId: string;
  status: "triggered" | "not_triggered" | "error";
  message?: string;
  updatedAt?: number;
  totalFound?: number;
  value?: number;
  threshold?: number;
  operator?: string;
}
