/**
 * The generated Prisma shapes the studio's closure names, restated. `~/generated/prisma/client`
 * is the application's generated client and a browser package may not reach it.
 */

/** How an evaluator runs: on every trace, on a sample, or only when called. */
export const EvaluationExecutionMode = {
  ON_MESSAGE: "ON_MESSAGE",
  AS_GUARDRAIL: "AS_GUARDRAIL",
  MANUALLY: "MANUALLY",
} as const;
export type EvaluationExecutionMode =
  (typeof EvaluationExecutionMode)[keyof typeof EvaluationExecutionMode];

/** Who a prompt belongs to. */
export const PromptScope = {
  PROJECT: "PROJECT",
  ORGANIZATION: "ORGANIZATION",
} as const;
export type PromptScope = (typeof PromptScope)[keyof typeof PromptScope];

/** The project row, as the surfaces that moved read it. */
export type Project = {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
  teamId: string;
  language: string;
  framework: string;
  firstMessage: boolean;
  integrated: boolean;
  createdAt: Date;
  updatedAt: Date;
  piiRedactionLevel?: string;
  s3Endpoint?: string | null;
  capturedInputVisibility?: string;
  capturedOutputVisibility?: string;
  defaultModel?: string | null;
  embeddingsModel?: string | null;
  topicClusteringModel?: string | null;
  userLinkTemplate?: string | null;
};

/** One experiment row, as the batch-evaluation surfaces read it. */
export type Experiment = {
  id: string;
  projectId: string;
  name: string | null;
  slug: string;
  type: string;
  workflowId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Prisma's own JSON array type, restated so no runtime package is named. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
