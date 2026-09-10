import { bindRestHeader, bindRestMiddleware, browserCallerOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { WorkflowApp } from "#app/workflow.app";
import { workflowRunContentType, workflowRunRest } from "#transport/workflow-run.rest";
import { workflowStudioRest, workflowStudioSession } from "#transport/workflow-studio.rest";
import { workflowOptimizationTrpcTransport } from "#transport/workflow-optimization.trpc";
import { workflowTrpcTransport } from "#transport/workflow.trpc";

/**
 * The `/api/workflows` CRUD family is not here: it needs the deployment's own
 * platform-URL builder to write the studio link on every row, so the process
 * mounts `createWorkflowRest(platformUrl)` itself.
 */
export const workflowServer = defineServerModule("workflow")
  .withApp(WorkflowApp)
  .withTransports(
    workflowTrpcTransport,
    workflowOptimizationTrpcTransport,
    workflowRunRest,
    workflowStudioRest,
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
