import { KSUID_RESOURCES } from "@langwatch/ksuid";
import { generate } from "@langwatch/ksuid";

export function generateWorkflowRunId(): string {
  return `run_${generate(KSUID_RESOURCES.WORKFLOW_TRACE).toString()}`;
}

export function generateWorkflowEdgeId(): string {
  return `edge_${generate(KSUID_RESOURCES.WORKFLOW).toString()}`;
}
