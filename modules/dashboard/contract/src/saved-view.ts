import type { Named } from "@langwatch/module";
/**
 * The stored filter sets the explorer offers: one row shape, shared by the
 * repository, the application and the tRPC surface that answers with it.
 */
import { z } from "zod";

/** The house id scheme's kind for a saved view. */
export const SAVED_VIEW_KSUID_RESOURCE = "view";

/**
 * A JSON value as a saved view stores it. Named here rather than taken from
 * Prisma so a view's filters can be described without importing the generated
 * client.
 */
export type SavedViewJson =
  | string
  | number
  | boolean
  | null
  | SavedViewJson[]
  // Members are optional to match how a JSON object arrives from storage.
  | { [key: string]: SavedViewJson | undefined };

export const savedViewJsonSchema: z.ZodType<SavedViewJson> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(savedViewJsonSchema),
    z.record(z.string(), savedViewJsonSchema),
  ]),
);

/** The storage shape a client reads and writes; omitted means the v1 default. */
export const savedViewKindSchema = z.string();

export const savedViewNameSchema = z.string().min(1).max(255);

/**
 * A saved view as the repository hands it back, and as tRPC ships it: the
 * stored row untouched, so its timestamps are the wire timestamps it carries.
 */
const savedViewSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  filters: savedViewJsonSchema,
  query: z.string().nullable(),
  period: savedViewJsonSchema.nullable(),
  order: z.number().int(),
  kind: savedViewKindSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export interface SavedViewSchema extends Named<typeof savedViewSchemaDefinition> {}
export const savedViewSchema: SavedViewSchema = savedViewSchemaDefinition;
export type SavedView = z.infer<typeof savedViewSchema>;

/** The stored period a view remembers, exactly as the filter bar writes it. */
const savedViewPeriodSchemaDefinition = z.object({
  relativeDays: z.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export interface SavedViewPeriodSchema extends Named<typeof savedViewPeriodSchemaDefinition> {}
export const savedViewPeriodSchema: SavedViewPeriodSchema = savedViewPeriodSchemaDefinition;
export type SavedViewPeriod = z.infer<typeof savedViewPeriodSchema>;

const savedViewReorderResponseSchemaDefinition = z.object({ success: z.literal(true) });
export interface SavedViewReorderResponseSchema extends Named<
  typeof savedViewReorderResponseSchemaDefinition
> {}
export const savedViewReorderResponseSchema: SavedViewReorderResponseSchema =
  savedViewReorderResponseSchemaDefinition;
