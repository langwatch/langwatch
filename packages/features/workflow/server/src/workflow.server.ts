import { defineFeature } from "@langwatch/runtime-composition";
import { WorkflowApp } from "#app/workflow.app";
import { workflowRunRest } from "#transport/workflow-run.rest";
import { workflowStudioRest } from "#transport/workflow-studio.rest";
import { workflowOptimizationTrpcTransport } from "#transport/workflow-optimization.trpc";
import { workflowTrpcTransport } from "#transport/workflow.trpc";

/**
 * The `/api/workflows` CRUD family is not here: it needs the deployment's own
 * platform-URL builder to write the studio link on every row, so the process
 * mounts `createWorkflowRest(platformUrl)` itself.
 */
export const workflowServer = defineFeature("workflow")
  .withApp(WorkflowApp)
  .withTransports(
    workflowTrpcTransport,
    workflowOptimizationTrpcTransport,
    workflowRunRest,
    workflowStudioRest,
  )
  .build();
