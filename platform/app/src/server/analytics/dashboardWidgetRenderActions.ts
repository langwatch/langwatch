import type { AuthzPermission } from "@langwatch/authz";
import { z } from "zod";

/**
 * The dashboard page's UI actions an agent may dispatch, in one table.
 *
 * Framework-free on purpose (zod only): this module is imported by BOTH the
 * server registry (`~/server/app-layer/langy/ui-actions/pageManifests`) and
 * the browser page that registers the handler, exactly like the workbench's
 * `experiments-v3/actions/manifest`. Pulling React in here would trip
 * `src/server/__tests__/frontend-boundary.unit.test.ts`.
 *
 * `dashboard.getWidgetRender` is a READ, but a browser-only one: a render
 * receipt is what a widget PAINTED in a tab that has the dashboard open, and
 * there is no saved state to answer from when no tab is attached (unlike the
 * workbench, whose document persists). The away path therefore refuses rather
 * than falling back — see `uiActionBackendExecutor`.
 *
 * The markup is why the action exists: Langy runs on the server and cannot see
 * the tab, so it reads the rendered `#lw-root` (inline SVG for a recharts
 * chart, or the error panel) to "see" the widget — an empty chart, NaN or
 * undefined labels, overflow, an error message — before calling its own edit
 * done.
 */

export const getWidgetRenderPayloadSchema = z
  .object({
    widgetId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Return one widget's receipt including its rendered markup. Omit to list the dashboard's sandboxed widget cards (the code-defined ones that run in a frame) without markup; classic chart cards publish no receipt and are not listed.",
      ),
    shouldIncludeMarkup: z
      .boolean()
      .optional()
      .describe(
        "Include the rendered markup (SVG/HTML of the widget root) for every listed widget. Defaults to true when widgetId is given, false otherwise.",
      ),
  })
  .strict();

export const getWidgetRenderResultSchema = z.object({
  dashboardId: z.string().nullable(),
  widgets: z.array(
    z.object({
      widgetId: z.string(),
      widgetName: z.string().nullable(),
      status: z.enum(["ok", "error"]),
      errorText: z.string().nullable(),
      height: z.number(),
      theme: z.enum(["light", "dark"]),
      timeWindow: z.object({ start: z.number(), end: z.number() }),
      /** ISO 8601 — when the receipt was captured in the open tab. */
      capturedAt: z.string(),
      markup: z.string().optional(),
      isMarkupTruncated: z.boolean(),
    }),
  ),
});

/**
 * Structurally a `PageActionDefinition` (see `pageManifests`), declared here
 * without importing that type so the server registry can depend on this module
 * rather than the reverse.
 */
export type DashboardActionDefinition = {
  payloadSchema: z.ZodTypeAny;
  resultSchema?: z.ZodTypeAny;
  requiredPermission: AuthzPermission;
  executeBudgetMs?: number;
  backend: "read";
};

export const DASHBOARD_ACTIONS = {
  "dashboard.getWidgetRender": {
    payloadSchema: getWidgetRenderPayloadSchema,
    resultSchema: getWidgetRenderResultSchema,
    requiredPermission: "analytics:view",
    executeBudgetMs: 12_000,
    backend: "read",
  },
} as const satisfies Record<string, DashboardActionDefinition>;
