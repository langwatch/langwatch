/**
 * Every `prompts.*` procedure, declared once. The names are the browser's
 * cache keys, so they are the wire names the prompt studio has always called.
 *
 * `demonstrations` is a workflow dataset, and the workflow contract already
 * depends on this one, so the two write shapes take THIS contract's own
 * `nodeDatasetSchema` - the same shape, declared on the near side of the cycle.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { nodeDatasetSchema } from "./prompt.field-schemas.ts";
import {
  copiedPromptSchema,
  promptCopyChoiceSchema,
  promptDeleteResultSchema,
  promptModifyPermissionSchema,
  promptPushToCopiesResultSchema,
  promptTagAssignmentSchema,
  versionedPromptSchema,
} from "./prompt.ts";
import {
  createPromptCreateTrpcInputSchema,
  createPromptUpdateTrpcInputSchema,
  promptAssignTagTrpcInputSchema,
  promptConfigTagsTrpcInputSchema,
  promptCopyTrpcInputSchema,
  promptGetByIdOrHandleTrpcInputSchema,
  promptHandleUniquenessTrpcInputSchema,
  promptIdOrHandleTrpcInputSchema,
  promptProjectTrpcInputSchema,
  promptPushToCopiesTrpcInputSchema,
  promptRestoreVersionTrpcInputSchema,
  promptUpdateHandleTrpcInputSchema,
} from "./prompt.trpc-schemas.ts";

/** What a browser sends to `prompts.create`. */
export const promptCreateTrpcInputSchema = createPromptCreateTrpcInputSchema({
  demonstrationsSchema: nodeDatasetSchema,
});

/** What a browser sends to `prompts.update`: a new version, so a message. */
export const promptUpdateTrpcInputSchema = createPromptUpdateTrpcInputSchema({
  demonstrationsSchema: nodeDatasetSchema,
});

export const promptTrpc = defineTrpcContract("prompts")
  .query("getAllPromptsForProject")
  .withInput(promptProjectTrpcInputSchema)
  .withOutput(versionedPromptSchema.array())

  // The copies of a prompt this caller may push to, for the picker.
  .query("getCopies")
  .withInput(promptIdOrHandleTrpcInputSchema)
  .withOutput(promptCopyChoiceSchema.array())

  .mutation("restoreVersion")
  .withInput(promptRestoreVersionTrpcInputSchema)
  .withOutput(versionedPromptSchema)

  .mutation("create")
  .withInput(promptCreateTrpcInputSchema)
  .withOutput(versionedPromptSchema)

  // Handle and scope do NOT travel here: they create no version and need no
  // message, and `updateHandle` is the door for them.
  .mutation("update")
  .withInput(promptUpdateTrpcInputSchema)
  .withOutput(versionedPromptSchema)

  .mutation("updateHandle")
  .withInput(promptUpdateHandleTrpcInputSchema)
  .withOutput(versionedPromptSchema)

  // Answers `null` rather than refusing: the drawer renders an empty form for
  // a prompt that is not there yet.
  .query("getByIdOrHandle")
  .withInput(promptGetByIdOrHandleTrpcInputSchema)
  .withOutput(versionedPromptSchema.nullable())

  .query("checkHandleUniqueness")
  .withInput(promptHandleUniquenessTrpcInputSchema)
  .withOutput(z.boolean())

  .query("checkModifyPermission")
  .withInput(promptIdOrHandleTrpcInputSchema)
  .withOutput(promptModifyPermissionSchema)

  .query("getAllVersionsForPrompt")
  .withInput(promptIdOrHandleTrpcInputSchema)
  .withOutput(versionedPromptSchema.array())

  .mutation("delete")
  .withInput(promptIdOrHandleTrpcInputSchema)
  .withOutput(promptDeleteResultSchema)

  .mutation("copy")
  .withInput(promptCopyTrpcInputSchema)
  .withOutput(copiedPromptSchema)

  // Duplicates a prompt inside the project it already belongs to. Unlike
  // `copy`, this never crosses a project boundary.
  .mutation("duplicate")
  .withInput(promptIdOrHandleTrpcInputSchema)
  .withOutput(versionedPromptSchema)

  .mutation("syncFromSource")
  .withInput(promptIdOrHandleTrpcInputSchema)
  .withOutput(versionedPromptSchema)

  .mutation("pushToCopies")
  .withInput(promptPushToCopiesTrpcInputSchema)
  .withOutput(promptPushToCopiesResultSchema)

  .query("getTagsForConfig")
  .withInput(promptConfigTagsTrpcInputSchema)
  .withOutput(promptTagAssignmentSchema.array())

  // Assigns - or moves - a tag onto one prompt version. Takes the built-in
  // tags and any the organization has defined.
  .mutation("assignTag")
  .withInput(promptAssignTagTrpcInputSchema)
  .withOutput(promptTagAssignmentSchema)
  .build();
