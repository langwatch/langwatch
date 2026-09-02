/**
 * The legacy online-evaluation edit form, as the browser application mounts it.
 *
 * TWO ADDRESSES, ONE SCREEN: `/:project/evaluations/:id/edit` and
 * `.../edit/choose`. `platform/app` served both from one module — the second
 * address predates the drawer that superseded this form and still resolves the
 * same page — so both keys name this loader and neither reads which one it was.
 *
 * WHY THIS PACKAGE. The evaluations/evaluators manifest recorded these two keys
 * as blocked on "~8,000 lines of copies", 1,414 of them the trace family's
 * mapping vocabulary. That number is zero now: the trace family MOVED
 * `tracesMapping` into `@langwatch/trace-web` and the studio slice moved
 * `CheckConfigForm` and its whole exclusive closure into this package, so
 * landing the screen took no copy at all. The transport is `monitors.*`, which
 * by the ownership rule is `@langwatch/monitor-web`'s — overruled on the form,
 * argued in the screen's own docblock.
 *
 * WHAT THE OWNING FRONTEND FEATURE MOUNTS is the WORKFLOW host: the form and
 * everything under it read `@langwatch/workflow-web/studio-host/*` for the
 * project, the transport, the router and the toasts, which is how the studio
 * slice left them.
 */

import type { ComponentType } from "react";

export type EvaluationEditScreenLoader = () => Promise<{ default: ComponentType }>;

export const evaluationEditScreens = {
  evaluationEdit: () => import("./evaluation-edit.screen"),
} as const satisfies Record<string, EvaluationEditScreenLoader>;

export type EvaluationEditScreenName = keyof typeof evaluationEditScreens;
