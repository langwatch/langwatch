import { bindRestHeader, bindRestMiddleware, browserCallerOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { WorkflowApp } from "#app/workflow.app";
import { workflowRepositories } from "#repositories/workflow-repositories.registry";
import { cronRest } from "#transport/cron.rest";
import { createWorkflowRest } from "#transport/workflow.rest";
import { workflowRunContentType, workflowRunRest } from "#transport/workflow-run.rest";
import { workflowStudioRest, workflowStudioSession } from "#transport/workflow-studio.rest";
import { workflowOptimizationTrpcTransport } from "#transport/workflow-optimization.trpc";
import { workflowTrpcTransport } from "#transport/workflow.trpc";

export const workflowServer = defineServerModule("workflow")
  .withRepositories(workflowRepositories)
  .withApp(WorkflowApp)
  .withTransports(
    createWorkflowRest(),
    workflowTrpcTransport,
    workflowOptimizationTrpcTransport,
    workflowRunRest,
    workflowStudioRest,
    cronRest,
  )
  // The run family is handed the media type rather than a parsed body: the
  // body is the workflow's own entry fields, so nothing validates it. The
  // studio family answers its own 401 in the sentence the editor renders, so
  // the byte door's answer reaches it as a fact rather than as a refusal.
  .withTransportFacts(() => [
    bindRestHeader(workflowRunContentType, "content-type"),
    bindRestMiddleware(workflowStudioSession, (context) => {
      const caller = browserCallerOfRequest(context.req.raw);

      return caller?.userId ? { user: { id: caller.userId } } : null;
    }),
  ])
  .build();
