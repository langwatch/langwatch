/**
 * What this package serves itself: `createUiApplication` merges the host's install over
 * this standing declaration. Sits at the features root — this registry and the package
 * entry are the only places allowed to import a feature.
 */

import { createDrawerPreloader, installDrawerOpenRewrite, useDrawer } from "@langwatch/ui-drawer";
import { warmChunk } from "../behavior/chunk-reload";
import { BrowserUiFeedback } from "../behavior/ui-feedback";
import { installUiFeatures } from "../behavior/ui-feature";
import { useBrowserUiSession } from "../behavior/ui-session";
import { agentFeature } from "./agent";
import { analyticsFeature } from "./analytics";
import { annotationFeature } from "./annotation";
import { annotationScoresFeature } from "./annotation-scores";
import { apiKeyFeature } from "./api-key";
import { authFeature } from "./auth";
import { authorizeFeature } from "./authorize";
import { authzFeature } from "./authz";
import { automationsFeature } from "./automations";
import { billingFeature } from "./billing";
import { chromeFeature } from "./chrome";
import { dataPrivacyFeature } from "./data-privacy";
import { dataRetentionFeature } from "./data-retention";
import { datasetFeature } from "./dataset";
import { routeTraceDrawerForV2 } from "../model/ui-trace-drawer-routing";
import { evaluationsFeature } from "./evaluations";
import { evaluatorFeature } from "./evaluator";
import { experimentsFeature } from "./experiments";
import { gatewayFeature } from "./gateway";
import { githubFeature } from "./github";
import { governanceFeature } from "./governance";
import { homeFeature } from "./home";
import { langyFeature } from "./langy";
import { licensingFeature } from "./licensing";
import { modelProviderFeature } from "./model-provider";
import { monitorFeature } from "./monitor";
import { navigationFeature } from "./navigation";
import { notificationFeature } from "./notification";
import { onboardingFeature } from "./onboarding";
import { opsFeature } from "./ops";
import { organizationFeature } from "./organization";
import { codingAgentFeature, personalWorkspaceFeature } from "./personal-workspace";
import { projectFeature } from "./project";
import { promptFeature } from "./prompt";
import { scimFeature } from "./scim";
import { secretFeature } from "./secret";
import { simulationsFeature } from "./simulations";
import { topicFeature } from "./topic";
import { traceFeature } from "./traces";
import { workflowFeature } from "./workflows";

/** Every feature this package installs. Order is preserved into `apis`. */
const features = [
  agentFeature,
  analyticsFeature,
  annotationFeature,
  annotationScoresFeature,
  apiKeyFeature,
  authFeature,
  authorizeFeature,
  authzFeature,
  automationsFeature,
  billingFeature,
  chromeFeature,
  dataPrivacyFeature,
  dataRetentionFeature,
  datasetFeature,
  evaluationsFeature,
  evaluatorFeature,
  experimentsFeature,
  gatewayFeature,
  githubFeature,
  governanceFeature,
  homeFeature,
  langyFeature,
  licensingFeature,
  modelProviderFeature,
  monitorFeature,
  navigationFeature,
  notificationFeature,
  onboardingFeature,
  opsFeature,
  organizationFeature,
  personalWorkspaceFeature,
  codingAgentFeature,
  projectFeature,
  promptFeature,
  scimFeature,
  secretFeature,
  simulationsFeature,
  topicFeature,
  traceFeature,
  workflowFeature,
] as const;

export const installedUiFeatures = installUiFeatures({
  features,
  capabilities: { feedback: BrowserUiFeedback.create() },
  session: useBrowserUiSession,
});

/** Every drawer this application answers, one map composed from every feature's own. */
export const installedUiDrawers = installedUiFeatures.drawers;

/** Every drawer name this application answers. */
export type UiInstalledDrawer = keyof typeof installedUiDrawers;

/**
 * The one rule the framework takes as an install: every trace open lands on the Trace
 * Explorer drawer, whichever name the call site spelled.
 */
installDrawerOpenRewrite(routeTraceDrawerForV2);

/**
 * The navigator, told which registry it is addressing.
 */
export const useUiDrawer = () => useDrawer<typeof installedUiDrawers>();

const preloader = createDrawerPreloader({ registry: installedUiDrawers, warm: warmChunk });

/** Fetch a drawer's code now. */
export const preloadUiDrawer = preloader.preload;

/** Fetch the drawers this screen opens, once the browser is idle. */
export const usePreloadUiDrawer = preloader.usePreload;
