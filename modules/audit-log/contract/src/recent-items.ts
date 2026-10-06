import { defineTrpcContract } from "@langwatch/module";
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
export const recentItemsInputSchema = z.object({
  projectId: z.string(),
  limit: z.number().min(1).max(50).default(12),
});
export type RecentItemsInput = z.infer<typeof recentItemsInputSchema>;

/** One entity the caller touched recently, as the home strip renders it. */
export const recentItemSchema = z
  .object({
    id: z.string().min(1),
    type: recentItemTypeSchema,
    name: z.string(),
    href: z.string(),
    updatedAt: z.date(),
  })
  .strict();
export type RecentItem = z.infer<typeof recentItemSchema>;

/** The `home.*` namespace: the recent-items strip, read from the caller's own audit trail. */

export const homeTrpc = defineTrpcContract("home")
  .query("getRecentItems")
  .withInput(recentItemsInputSchema)
  .withOutput(recentItemSchema.array())
  .build();
