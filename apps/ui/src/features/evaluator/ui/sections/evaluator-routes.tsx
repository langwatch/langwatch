/**
 * Which page key the evaluators screen answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. `withPermissionGuard("evaluations:view")`, unchanged
 * from the platform page.
 */

import { evaluatorScreens } from "@langwatch/evaluator-web/screens/evaluators";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { EvaluatorHost } from "./evaluator-host";

/** The grant the platform page carried, unchanged. */
const EVALUATORS_PAGE_PERMISSION = "evaluations:view";

export const evaluatorPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/evaluators": uiPage({
    screen: async () => {
      const module = await evaluatorScreens.evaluators();
      const Screen = module.default as ComponentType & { displayName?: string };
      Screen.displayName = "EvaluatorsPage";
      return { default: Screen };
    },
    host: EvaluatorHost,
    permission: EVALUATORS_PAGE_PERMISSION,
  }),
};
