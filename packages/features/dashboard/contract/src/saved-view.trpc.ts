/**
 * Every `savedViews.*` procedure, declared once: its name, its kind, what it
 * takes and what it answers. A personal view reaches only its owner.
 * Spec: packages/features/dashboard/specs/saved-views.feature.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  savedViewKindSchema,
  savedViewNameSchema,
  savedViewPeriodSchema,
  savedViewReorderResponseSchema,
  savedViewSchema,
} from "./saved-view.ts";

const projectScopeSchema = z.object({
  projectId: z.string(),
  // Storage shape to read. Omit for the legacy default ("v1-traces-filter") so
  // existing callers keep working; traces v2 passes "v2-traces-lens" to scope
  // to its own rows.
  kind: savedViewKindSchema.optional(),
});

const viewScopeSchema = z.object({ projectId: z.string(), viewId: z.string() });

export const savedViewCreateInputSchema = z.object({
  ...projectScopeSchema.shape,
  name: savedViewNameSchema,
  // `unknown` rather than the stored JSON union: this is the shape the filter
  // bar and the traces v2 lens already send, and narrowing it here would
  // refuse a payload the storage accepts.
  filters: z.record(z.string(), z.unknown()),
  query: z.string().optional(),
  period: savedViewPeriodSchema.optional(),
  scope: z.enum(["project", "myself"]).default("project"),
  // Optional client-provided id. Traces v2 generates lens ids locally so the
  // in-store active id keeps pointing at the same row after the server
  // roundtrip completes. The application still generates one if omitted.
  id: z.string().min(1).max(128).optional(),
});

export const savedViewTrpc = defineTrpcContract("savedViews")
  /** Auto-seeds the origin defaults the first time a project asks. */
  .query("getAll")
  .withInput(projectScopeSchema)
  .withOutput(savedViewSchema.array())

  /**
   * A `myself` view is visible only to its creator; a `project` view — the
   * default — is shared with everyone on the team.
   */
  .mutation("create")
  .withInput(savedViewCreateInputSchema)
  .withOutput(savedViewSchema)

  .mutation("delete")
  .withInput(viewScopeSchema)
  .withOutput(savedViewSchema)

  .mutation("rename")
  .withInput(z.object({ ...viewScopeSchema.shape, name: savedViewNameSchema }))
  .withOutput(savedViewSchema)

  .mutation("reorder")
  .withInput(z.object({ projectId: z.string(), viewIds: z.array(z.string()) }))
  .withOutput(savedViewReorderResponseSchema)
  .build();
