/**
 * Every `project.*` procedure, declared once. The names are the browser's
 * cache keys, so they are the wire names the screens have always called.
 * Spec: packages/features/project/specs/project-service.feature.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  projectArchiveByIdInputSchema,
  projectCreateInputSchema,
  projectScopeSchema,
  projectUpdateInputSchema,
} from "./project-trpc.schemas.ts";
import {
  projectApiKeyRotationSchema,
  projectArchivedSchema,
  projectFieldRedactionStatusSchema,
  projectFirstMessageSchema,
  projectProvisionedSchema,
  projectSettingsSavedSchema,
  topicClusteringRequestSchema,
} from "./project.responses.ts";
import { projectSchema } from "./project.ts";

export const projectTrpc = defineTrpcContract("project")
  .mutation("create")
  .withInput(projectCreateInputSchema)
  .withOutput(projectProvisionedSchema)

  // The project row behind the settings page, base key included.
  .query("getProjectAPIKey")
  .withInput(projectScopeSchema)
  .withOutput(projectSchema)

  // Whether the project has ever received a trace, which is what the setup
  // screens wait on.
  .query("getHasFirstMessage")
  .withInput(projectScopeSchema)
  .withOutput(projectFirstMessageSchema)

  .mutation("regenerateApiKey")
  .withInput(projectScopeSchema)
  .withOutput(projectApiKeyRotationSchema)

  .mutation("update")
  .withInput(projectUpdateInputSchema)
  .withOutput(projectSettingsSavedSchema)

  // Whether this viewer may read captured input and output, and who can if
  // they may not.
  .query("getFieldRedactionStatus")
  .withInput(projectScopeSchema)
  .withOutput(projectFieldRedactionStatusSchema)

  // Archives a DIFFERENT project than the one the caller is currently in.
  .mutation("archiveById")
  .withInput(projectArchiveByIdInputSchema)
  .withOutput(projectArchivedSchema)

  .mutation("triggerTopicClustering")
  .withInput(projectScopeSchema)
  .withOutput(topicClusteringRequestSchema)
  .build();
