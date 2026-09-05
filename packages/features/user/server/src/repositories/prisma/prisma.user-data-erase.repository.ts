import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Exactly the model delegate methods this task calls, picked from the real `PrismaClient`
 * rather than hand-typed, so a real `PrismaClient` satisfies this narrower shape for free.
 */
type Delegate<Model extends keyof PrismaClient, Methods extends keyof PrismaClient[Model]> = Pick<
  PrismaClient[Model],
  Methods
>;

/**
 * Deliberately unprotected (no `projectId`/`organizationId` scoping): this walk is cross-tenant
 * by design — the one place in the product that discovers and removes a single user's data
 * across every organization they touched, across ~25 tables no single feature's port fronts.
 */
export type GdprUserDataEraseDatabase = {
  user: Delegate<"user", "findUnique" | "delete">;
  organization: Delegate<"organization", "findMany" | "deleteMany">;
  organizationUser: Delegate<"organizationUser", "count" | "deleteMany">;
  team: Delegate<"team", "findMany" | "deleteMany">;
  teamUser: Delegate<"teamUser", "deleteMany">;
  project: Delegate<"project", "findMany" | "deleteMany">;
  account: Delegate<"account", "count" | "deleteMany">;
  session: Delegate<"session", "count" | "deleteMany">;
  annotation: Delegate<"annotation", "count" | "updateMany" | "deleteMany">;
  shareLink: Delegate<"shareLink", "count" | "updateMany" | "deleteMany">;
  workflow: Delegate<"workflow", "count" | "updateMany" | "deleteMany">;
  workflowVersion: Delegate<"workflowVersion", "count" | "deleteMany">;
  llmPromptConfig: Delegate<"llmPromptConfig", "findMany" | "deleteMany">;
  llmPromptConfigVersion: Delegate<"llmPromptConfigVersion", "count" | "updateMany" | "deleteMany">;
  annotationQueueItem: Delegate<"annotationQueueItem", "count" | "updateMany" | "deleteMany">;
  annotationQueueMembers: Delegate<"annotationQueueMembers", "count" | "deleteMany">;
  annotationQueueScores: Delegate<"annotationQueueScores", "deleteMany">;
  annotationQueue: Delegate<"annotationQueue", "findMany" | "deleteMany">;
  auditLog: Delegate<"auditLog", "count" | "updateMany">;
  batchEvaluation: Delegate<"batchEvaluation", "deleteMany">;
  monitor: Delegate<"monitor", "deleteMany">;
  experiment: Delegate<"experiment", "deleteMany">;
  datasetRecord: Delegate<"datasetRecord", "deleteMany">;
  dataset: Delegate<"dataset", "deleteMany">;
  customGraph: Delegate<"customGraph", "deleteMany">;
  dashboard: Delegate<"dashboard", "deleteMany">;
  trigger: Delegate<"trigger", "deleteMany">;
  topic: Delegate<"topic", "deleteMany">;
  cost: Delegate<"cost", "deleteMany">;
  // ModelProvider is organization-scoped (ADR-021); a project's own binding
  // is the scope row, not the provider itself, which other projects in the
  // organization may still use.
  modelProviderScope: Delegate<"modelProviderScope", "deleteMany">;
  $transaction: PrismaClient["$transaction"];
};
