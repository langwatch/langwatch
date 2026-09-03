/**
 * The Optimization Studio, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/:project/studio/:workflow`. The third key of the
 * Workflows family, and the one the family's first move recorded as blocked.
 *
 * WHAT UNBLOCKED IT was the deletes-only ruling read the other way round. The
 * block was never ownership — the studio's transport is `workflow.*` and
 * `optimization.*` and its types are `@langwatch/workflow-contract`'s — it was
 * a copy set of 220 platform modules and 40,543 lines, because a family may not
 * copy and `platform/app` may not shrink a module another page still imports.
 * Under "the platform does not have to work during this migration" those stop
 * being copies and become MOVES: each module goes to the feature package that
 * owns it by vocabulary, and the platform files that still imported it are left
 * broken rather than repointed.
 *
 * WHERE THE VOCABULARY WENT, one line each:
 *   - `@langwatch/experiment-web` — all of `experiments-v3` and Batch Evaluation V2
 *   - `@langwatch/evaluator-web` — `DynamicZodForm`, `CheckConfigForm`, the evaluator editor
 *   - `@langwatch/analytics-web` — `FieldsFilters` and the saved-view surface
 *   - `@langwatch/dataset-web` — `UploadCSVDrawer` and the dataset editor
 *   - `@langwatch/prompt-web` — `PromptEditorDrawer` and the prompt form
 *   - `@langwatch/model-provider-web` — the model selector and the provider icons
 *   - `@langwatch/trace-web` — `TracesMapping`, `SpanDetails` and `tracesMapping`
 * and what no feature owns — the dialog, the drawer, the generic form controls
 * and the small formatting helpers — stayed with the studio that needs it.
 *
 * THE SCREEN IS LAZY AND THE BARREL IS NOT THE ENTRY. `apps/ui` compiles
 * whatever this file re-exports under its own stricter tsconfig, so the screen
 * itself is reached through a dynamic import and everything else here is a type
 * or a port.
 */

import type { ComponentType } from "react";

export type StudioScreenLoader = () => Promise<{ default: ComponentType }>;

export const studioScreens = {
  studio: () => import("./studio.screen"),
} as const satisfies Record<string, StudioScreenLoader>;

export type StudioScreenName = keyof typeof studioScreens;
