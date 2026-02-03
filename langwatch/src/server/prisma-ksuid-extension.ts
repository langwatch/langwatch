import { Prisma } from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * Map Prisma model names to KSUID resource prefixes.
 * Models not listed here will use their lowercase model name as the resource prefix.
 */
const MODEL_TO_RESOURCE: Record<string, string> = {
  // Core auth models
  Account: KSUID_RESOURCES.ACCOUNT,
  Session: KSUID_RESOURCES.SESSION,
  User: KSUID_RESOURCES.USER,

  // Organization models
  Organization: KSUID_RESOURCES.ORGANIZATION,
  OrganizationInvite: KSUID_RESOURCES.ORG_INVITE,
  OrganizationUser: KSUID_RESOURCES.ORG_USER,
  OrganizationFeature: KSUID_RESOURCES.ORG_FEATURE,

  // Team models
  Team: KSUID_RESOURCES.TEAM,
  TeamUser: KSUID_RESOURCES.TEAM_USER,

  // Project models
  Project: KSUID_RESOURCES.PROJECT,
  ModelProvider: KSUID_RESOURCES.MODEL_PROVIDER,
  Agent: KSUID_RESOURCES.AGENT,
  Evaluator: KSUID_RESOURCES.EVALUATOR,
  Scenario: KSUID_RESOURCES.SCENARIO,

  // Monitoring models
  Monitor: KSUID_RESOURCES.MONITOR,
  Cost: KSUID_RESOURCES.COST,
  Trigger: KSUID_RESOURCES.TRIGGER,
  TriggerSent: KSUID_RESOURCES.TRIGGER_SENT,

  // Data models
  Topic: KSUID_RESOURCES.TOPIC,
  Dataset: KSUID_RESOURCES.DATASET,
  DatasetRecord: KSUID_RESOURCES.DATASET_RECORD,
  CustomGraph: KSUID_RESOURCES.CUSTOM_GRAPH,
  Dashboard: KSUID_RESOURCES.DASHBOARD,

  // Evaluation models
  Experiment: KSUID_RESOURCES.EXPERIMENT,
  BatchEvaluation: KSUID_RESOURCES.BATCH_EVALUATION,

  // Annotation models
  Annotation: KSUID_RESOURCES.ANNOTATION,
  AnnotationScore: KSUID_RESOURCES.ANNOTATION_SCORE,
  AnnotationQueue: KSUID_RESOURCES.ANNOTATION_QUEUE,
  AnnotationQueueItem: KSUID_RESOURCES.ANNOTATION_QUEUE_ITEM,

  // Workflow models
  Workflow: KSUID_RESOURCES.WORKFLOW,
  WorkflowVersion: KSUID_RESOURCES.WORKFLOW_VERSION,

  // Other models
  PublicShare: KSUID_RESOURCES.PUBLIC_SHARE,
  CustomLLMModelCost: KSUID_RESOURCES.CUSTOM_LLM_MODEL_COST,
  LlmPromptConfig: KSUID_RESOURCES.PROMPT_CONFIG,
  LlmPromptConfigVersion: KSUID_RESOURCES.PROMPT_CONFIG_VERSION,
  Analytics: KSUID_RESOURCES.ANALYTICS,
  CustomRole: KSUID_RESOURCES.CUSTOM_ROLE,
  Notification: KSUID_RESOURCES.NOTIFICATION,
};

/**
 * Prisma Client Extension that automatically generates KSUID for all create operations.
 *
 * This extension intercepts `create` and `createMany` operations and generates
 * a KSUID with the appropriate resource prefix if no `id` is provided.
 *
 * The environment prefix (dev_, staging_, etc.) is automatically included based on
 * the environment set via `setEnvironment()` from @langwatch/ksuid.
 *
 * @example
 * ```typescript
 * // Without explicit ID - KSUID is auto-generated
 * const user = await prisma.user.create({
 *   data: { email: "test@example.com" }
 * });
 * console.log(user.id); // "user_00028U9MDT583X9eXPG1IU0ptdl1l" (prod)
 *                       // "dev_user_00028U9MDT583X9eXPG1IU0ptdl1l" (dev)
 *
 * // With explicit ID - uses provided value
 * const user = await prisma.user.create({
 *   data: { id: "custom-id", email: "test@example.com" }
 * });
 * console.log(user.id); // "custom-id"
 * ```
 */
export const ksuidExtension = Prisma.defineExtension({
  query: {
    $allModels: {
      async create({ model, args, query }) {
        const resource =
          MODEL_TO_RESOURCE[model] ?? model.toLowerCase().slice(0, 16);
        const data = args.data as Record<string, unknown>;
        if (!data.id) {
          data.id = generate(resource).toString();
        }
        return query(args);
      },
      async createMany({ model, args, query }) {
        const resource =
          MODEL_TO_RESOURCE[model] ?? model.toLowerCase().slice(0, 16);
        if (Array.isArray(args.data)) {
          for (const item of args.data) {
            const record = item as Record<string, unknown>;
            if (!record.id) {
              record.id = generate(resource).toString();
            }
          }
        }
        return query(args);
      },
    },
  },
});
