/**
 * Every `project.*` procedure, declared once. The names are the browser's
 * cache keys, so they are the wire names the screens have always called.
 * Spec: modules/project/specs/project-service.feature.
 */
import { defineTrpcContract } from "@langwatch/module";

import {
  projectArchiveByIdInputSchema,
  projectCreateInputSchema,
  projectScopeSchema,
  projectUpdateInputSchema,
} from "./project-trpc.schemas.ts";
import { PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE } from "./project.events.ts";
import {
  projectApiKeyRevokedSchema,
  projectArchivedSchema,
  projectFieldRedactionStatusSchema,
  projectFirstMessageSchema,
  projectLegacyKeyStatusSchema,
  projectProvisionedSchema,
  projectSettingsSavedSchema,
  topicClusteringRequestSchema,
} from "./project.responses.ts";

export const projectTrpc = defineTrpcContract("project")
  .mutation("create")
  .withInput(projectCreateInputSchema)
  .withOutput(projectProvisionedSchema)

  // Whether the project has ever received a trace, which is what the setup
  // screens wait on.
  .query("getHasFirstMessage")
  .withInput(projectScopeSchema)
  .withOutput(projectFirstMessageSchema)

  // Whether the legacy project key still works. Never the key itself.
  .query("getLegacyKeyStatus", {
    invalidatedBy: [{ event: PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE, scope: "projectId" }],
  })
  .withInput(projectScopeSchema)
  .withOutput(projectLegacyKeyStatusSchema)

  // Revokes the legacy project key for good and shows no new key.
  .mutation("revokeProjectApiKey")
  .withInput(projectScopeSchema)
  .withOutput(projectApiKeyRevokedSchema)

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
