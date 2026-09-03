/**
 * Which page key the evaluators screen answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The page is wrapped twice, and the order matters. The
 * host provider is OUTSIDE the guard: a refusal renders the guard's own
 * fallback, which asks nothing of the evaluator host, but a page that opens
 * needs the host mounted above it before its first render. Inside that, the
 * guard states the policy the platform higher-order component carried —
 * `withPermissionGuard("evaluations:view")`, unchanged.
 *
 * `layoutComponent: DashboardLayout` was the other half of that call and does
 * not travel: chrome belongs to the route tree, and this page is a child of a
 * layout route the composing application still serves.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import { evaluatorScreens } from "@langwatch/evaluator-web/screens/evaluators";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { EVALUATORS_PAGE_PERMISSION } from "../../behavior/evaluator-host.adapter";
import { withEvaluatorHost } from "./evaluator-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

export const evaluatorPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/evaluators": async () => {
    const module = await evaluatorScreens.evaluators();
    const guarded = withUiPageGuard({
      permission: EVALUATORS_PAGE_PERMISSION,
      fallbacks: FALLBACKS,
    })(module.default);
    guarded.displayName = "EvaluatorsPage";
    return { default: withEvaluatorHost(guarded) };
  },
};
