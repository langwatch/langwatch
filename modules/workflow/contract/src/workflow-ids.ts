import { KSUID_RESOURCES, generate } from "@langwatch/ksuid";

export function generateWorkflowRunId(): string {
  return `run_${generate(KSUID_RESOURCES.WORKFLOW_TRACE).toString()}`;
}

export function generateWorkflowEdgeId(): string {
  return `edge_${generate(KSUID_RESOURCES.WORKFLOW).toString()}`;
}
