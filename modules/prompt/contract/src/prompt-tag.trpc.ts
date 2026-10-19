/**
 * Every `promptTags.*` procedure, declared once. A tag definition is one
 * ORGANIZATION row reached through the project the caller named, which is why
 * each input carries a project id and none carries an organization id.
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { promptDeleteResultSchema, promptTagSchema } from "./prompt.ts";

/** The project a tag read is reached through. */
const promptTagProjectTrpcInputSchemaDefinition = z.object({ projectId: z.string() });
export interface PromptTagProjectTrpcInputSchema extends Named<
  typeof promptTagProjectTrpcInputSchemaDefinition
> {}
export const promptTagProjectTrpcInputSchema: PromptTagProjectTrpcInputSchema =
  promptTagProjectTrpcInputSchemaDefinition;

/** A tag definition named for creation or deletion. */
const promptTagNameTrpcInputSchemaDefinition = z.object({
  projectId: z.string(),
  name: z.string(),
});
export interface PromptTagNameTrpcInputSchema extends Named<
  typeof promptTagNameTrpcInputSchemaDefinition
> {}
export const promptTagNameTrpcInputSchema: PromptTagNameTrpcInputSchema =
  promptTagNameTrpcInputSchemaDefinition;

/** A tag definition renamed, and every assignment that names it. */
const promptTagRenameTrpcInputSchemaDefinition = z.object({
  projectId: z.string(),
  oldName: z.string(),
  newName: z.string(),
});
export interface PromptTagRenameTrpcInputSchema extends Named<
  typeof promptTagRenameTrpcInputSchemaDefinition
> {}
export const promptTagRenameTrpcInputSchema: PromptTagRenameTrpcInputSchema =
  promptTagRenameTrpcInputSchemaDefinition;

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

export const SEEDED_TAGS = ["production", "staging"] as const;
export type SeededTag = (typeof SEEDED_TAGS)[number];
