/**
 * Every `promptTags.*` procedure, declared once. A tag definition is one
 * ORGANIZATION row reached through the project the caller named, which is why
 * each input carries a project id and none carries an organization id.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { promptDeleteResultSchema, promptTagSchema } from "./prompt.ts";

/** The project a tag read is reached through. */
export const promptTagProjectTrpcInputSchema = z.object({ projectId: z.string() });

/** A tag definition named for creation or deletion. */
export const promptTagNameTrpcInputSchema = z.object({
  projectId: z.string(),
  name: z.string(),
});

/** A tag definition renamed, and every assignment that names it. */
export const promptTagRenameTrpcInputSchema = z.object({
  projectId: z.string(),
  oldName: z.string(),
  newName: z.string(),
});

export const promptTagTrpc = defineTrpcContract("promptTags")
  .query("getAll")
  .withInput(promptTagProjectTrpcInputSchema)
  .withOutput(promptTagSchema.array())

  .mutation("create")
  .withInput(promptTagNameTrpcInputSchema)
  .withOutput(promptTagSchema)

  .mutation("rename")
  .withInput(promptTagRenameTrpcInputSchema)
  .withOutput(promptTagSchema)

  .mutation("delete")
  .withInput(promptTagNameTrpcInputSchema)
  .withOutput(promptDeleteResultSchema)
  .build();
