import { z } from "zod";
import { LENS_CAPABILITIES, getCapability } from "./capabilities";

/**
 * Wire-format schema for a freshly-configured lens, validated at the boundary
 * between the dialog (UI) and `viewStore.createLens` (persistence). Keeping
 * the runtime check next to the inferred type means consumers never have to
 * worry about whether a lens draft is structurally sane — invalid drafts get
 * rejected before they reach the store.
 */

export const groupingModeSchema = z.enum([
  "flat",
  "by-conversation",
  "by-service",
  "by-user",
  "by-model",
]);

export const sortDirectionSchema = z.enum(["asc", "desc"]);

export const sortConfigSchema = z.object({
  columnId: z.string().min(1),
  direction: sortDirectionSchema,
});

export const lensDraftSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(80, "Name must be 80 characters or fewer"),
    grouping: groupingModeSchema,
    columns: z.array(z.string()).min(1, "Pick at least one column"),
    addons: z.array(z.string()),
    sort: sortConfigSchema,
    filterText: z.string(),
  })
  .superRefine((draft, ctx) => {
    const capability = getCapability(draft.grouping);
    const colSet = new Set(capability.columns.map((c) => c.id));
    for (const id of draft.columns) {
      if (!colSet.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["columns"],
          message: `Column "${id}" is not available under ${draft.grouping}`,
        });
      }
    }
    const addonSet = new Set(capability.addons.map((a) => a.id));
    for (const id of draft.addons) {
      if (!addonSet.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["addons"],
          message: `Addon "${id}" is not available under ${draft.grouping}`,
        });
      }
    }
    const sortable = new Set(capability.sortableColumnIds);
    if (!sortable.has(draft.sort.columnId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sort", "columnId"],
        message: `Column "${draft.sort.columnId}" is not sortable under ${draft.grouping}`,
      });
    }
  });

export type LensDraft = z.infer<typeof lensDraftSchema>;

/** Identity check used by the dialog to know when "Create" should enable. */
export function isLensDraftValid(draft: LensDraft): boolean {
  return lensDraftSchema.safeParse(draft).success;
}

/** Cheap sanity guard that doesn't run the full schema. */
export function isKnownGrouping(
  value: unknown,
): value is keyof typeof LENS_CAPABILITIES {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LENS_CAPABILITIES, value)
  );
}
