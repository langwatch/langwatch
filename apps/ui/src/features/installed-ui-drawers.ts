/**
 * The drawers this application serves, declared in one place.
 *
 * THE COMPANION TO `installed-ui-features.ts`, and deliberately its twin: that
 * file spreads one page-loader registry per feature, this one spreads one
 * drawer registry per feature. `platform/app` could not do this — its
 * `components/drawerRegistry.ts` named forty-five components by module path,
 * every one of them a module of that application — and that single fact is why
 * eighteen family manifests recorded the same gap: a screen wrote
 * `?drawer.open=<name>` and nothing opened.
 *
 * A FEATURE OWNS ITS DRAWERS. Each entry below comes from the feature that owns
 * the drawer, which owns the address, the props it reads off it and the host
 * the drawer needs mounted above it. Nothing here knows what any drawer
 * renders.
 *
 * This file sits at the features root for the same reason its twin does: a
 * global layer may not import a private feature, and the package entry and
 * these two registries are the only places allowed to compose them.
 */

import {
  createDrawerPreloader,
  installDrawerOpenRewrite,
  useDrawer,
  type UiDrawerRegistry,
} from "@langwatch/ui-drawer";

import { warmChunk } from "../behavior/chunk-reload";
import { agentDrawers } from "./agent";
import { annotationScoresDrawers } from "./annotation-scores";
import { automationsDrawers } from "./automations";
import { datasetDrawers } from "./dataset";
import { routeTraceDrawerForV2 } from "./drawers";
import { evaluatorDrawers } from "./evaluator";
import { experimentDrawers } from "./experiments";
import { gatewayDrawers } from "./gateway";
import { opsDrawers } from "./ops";
import { organizationDrawers } from "./organization";
import { modelProviderDrawers } from "./model-provider";
import { projectDrawers } from "./project";
import { promptDrawers } from "./prompt";
import { workflowDrawers } from "./workflows";
import { simulationsDrawers } from "./simulations";
import { traceDrawers } from "./traces";

export const installedUiDrawers = {
  ...agentDrawers,
  ...annotationScoresDrawers,
  ...automationsDrawers,
  ...datasetDrawers,
  ...evaluatorDrawers,
  ...experimentDrawers,
  ...gatewayDrawers,
  ...opsDrawers,
  ...organizationDrawers,
  ...modelProviderDrawers,
  ...projectDrawers,
  ...promptDrawers,
  ...simulationsDrawers,
  ...traceDrawers,
  ...workflowDrawers,
} satisfies UiDrawerRegistry;

/** Every drawer name this application answers. */
export type UiInstalledDrawer = keyof typeof installedUiDrawers;

/**
 * The one rule the framework takes as an install: every trace open lands on the
 * Trace Explorer drawer, whichever name the call site spelled.
 *
 * Registered at module scope rather than from a component, because the rule has
 * to be in force for a `traceDetails` open that happens before anything the
 * chrome renders has mounted — a deep link, or a notification the reader
 * followed.
 */
installDrawerOpenRewrite(routeTraceDrawerForV2);

/**
 * The navigator, told which registry it is addressing.
 *
 * `openDrawer("evaluatorHistory", { evaluatorId })` is checked against the
 * drawer's own props at the call site, which is what `platform/app` got from
 * `keyof typeof drawers` and what a composed registry keeps.
 */
export const useUiDrawer = () => useDrawer<typeof installedUiDrawers>();

const preloader = createDrawerPreloader({ registry: installedUiDrawers, warm: warmChunk });

/** Fetch a drawer's code now. */
export const preloadUiDrawer = preloader.preload;

/** Fetch the drawers this screen opens, once the browser is idle. */
export const usePreloadUiDrawer = preloader.usePreload;
