import { generate } from "@langwatch/ksuid";

import { KSUID_RESOURCES } from "./ksuid-resources.ts";

export function generateWorkflowRunId(): string {
  return `run_${generate(KSUID_RESOURCES.WORKFLOW_TRACE).toString()}`;
}

export function generateWorkflowEdgeId(): string {
  return `edge_${generate(KSUID_RESOURCES.WORKFLOW).toString()}`;
}
