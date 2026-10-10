import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

export const recentItemTypeSchema = z.enum([
  "prompt",
  "workflow",
  "dataset",
  "evaluation",
  "annotation",
  "simulation",
]);
export type RecentItemType = z.infer<typeof recentItemTypeSchema>;

/** The recent-items strip: one project, and how many rows it renders. */
const recentItemsInputSchemaDefinition = z.object({
  projectId: z.string(),
  limit: z.number().min(1).max(50).default(12),
});
export interface RecentItemsInputSchema extends Named<typeof recentItemsInputSchemaDefinition> {}
export const recentItemsInputSchema: RecentItemsInputSchema = recentItemsInputSchemaDefinition;
export type RecentItemsInput = z.infer<typeof recentItemsInputSchema>;

/** One entity the caller touched recently; the browser names and links it from its owner's list. */
const recentItemSchemaDefinition = z
  .object({
    id: z.string().min(1),
    type: recentItemTypeSchema,
    updatedAt: z.date(),
  })
  .strict();
export interface RecentItemSchema extends Named<typeof recentItemSchemaDefinition> {}
export const recentItemSchema: RecentItemSchema = recentItemSchemaDefinition;
export type RecentItem = z.infer<typeof recentItemSchema>;

/** The `home.*` namespace: the recent-items strip, read from the caller's own audit trail. */

export const homeTrpc = defineTrpcContract("home")
  .query("getRecentItems")
  .withInput(recentItemsInputSchema)
  .withOutput(recentItemSchema.array())
  .build();
