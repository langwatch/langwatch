import { WorkflowApi } from "@langwatch/workflow-contract";
import { defineFeature, type FeatureSetup } from "@langwatch/runtime-composition";
import { WorkflowApp, type WorkflowAppDependencies } from "#app/workflow.app";

export type { WorkflowAppDependencies };

export const workflowServer = defineFeature("workflow")
  .withApp({
    contract: WorkflowApi,
    dependencies: {},
    create: (setup: FeatureSetup<Readonly<Record<never, never>>, WorkflowAppDependencies, undefined>) =>
      WorkflowApp.create(setup),
  })
  .build();
