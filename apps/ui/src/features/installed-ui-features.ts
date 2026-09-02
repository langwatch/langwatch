/**
 * What this package serves itself, declared in one place.
 *
 * `createUiApplication` takes a feature install, and until now every field of
 * it came from the composing application. That was right while apps/ui served
 * no pages of its own; it is wrong now that it does, because it would mean a
 * host had to know about — and pass — a screen that moved out of its own source
 * tree. So the standing declaration lives here, the host's install is merged
 * over it, and `platform/app`'s shell adapter keeps passing nothing at all.
 *
 * This file sits at the features root rather than inside a feature on purpose:
 * a global layer may not import a private feature, and the package entry and
 * this registry are the only two places allowed to compose them.
 */

import { BrowserUiFeedback } from "../behavior/ui-feedback";
import { useBrowserUiSession } from "../behavior/ui-session";
import type { UiFeatureInstall } from "../ui/sections/ui-application";
import { agentApiBinding, agentPageLoaders } from "./agent";
import { analyticsApiBinding, analyticsPageLoaders } from "./analytics";
import { apiKeyApiBinding, apiKeyPageLoaders } from "./api-key";
import { annotationApiBinding, annotationPageLoaders } from "./annotation";
import { authApiBinding, authPageLoaders } from "./auth";
import { authzApiBinding, authzPageLoaders } from "./authz";
import { chromePageLoaders } from "./chrome";
import { automationsAllPageLoaders, automationsApiBinding } from "./automations";
import { dataPrivacyApiBinding, dataPrivacyPageLoaders } from "./data-privacy";
import { dataRetentionApiBinding, dataRetentionPageLoaders } from "./data-retention";
import { datasetApiBinding, datasetPageLoaders } from "./dataset";
import { evaluatorApiBinding, evaluatorPageLoaders } from "./evaluator";
import { gatewayApiBinding, gatewayPageLoaders } from "./gateway";
import { githubApiBinding, githubPageLoaders } from "./github";
import { governanceApiBinding, governancePageLoaders } from "./governance";
import { modelProviderApiBinding, modelProviderPageLoaders } from "./model-provider";
import { navigationApiBinding, navigationPageLoaders } from "./navigation";
import { monitorApiBinding, monitorPageLoaders } from "./monitor";
import { opsApiBinding, opsPageLoaders } from "./ops";
import { organizationApiBinding, organizationPageLoaders } from "./organization";
import { promptApiBinding, promptPageLoaders } from "./prompt";
import { secretApiBinding, secretPageLoaders } from "./secret";
import { traceApiBinding, tracePageLoaders } from "./traces";
import { workflowApiBinding, workflowPageLoaders } from "./workflows";
import { personalWorkspaceApiBindings, personalWorkspacePageLoaders } from "./personal-workspace";

export const installedUiFeatures: UiFeatureInstall = {
  loaders: {
    ...agentPageLoaders,
    ...analyticsPageLoaders,
    ...annotationPageLoaders,
    ...apiKeyPageLoaders,
    ...authPageLoaders,
    ...authzPageLoaders,
    ...chromePageLoaders,
    ...automationsAllPageLoaders,
    ...dataPrivacyPageLoaders,
    ...dataRetentionPageLoaders,
    ...datasetPageLoaders,
    ...evaluatorPageLoaders,
    ...gatewayPageLoaders,
    ...githubPageLoaders,
    ...governancePageLoaders,
    ...modelProviderPageLoaders,
    ...navigationPageLoaders,
    ...monitorPageLoaders,
    ...opsPageLoaders,
    ...organizationPageLoaders,
    ...promptPageLoaders,
    ...secretPageLoaders,
    ...tracePageLoaders,
    ...workflowPageLoaders,
    ...personalWorkspacePageLoaders,
  },
  apis: [
    agentApiBinding,
    analyticsApiBinding,
    annotationApiBinding,
    apiKeyApiBinding,
    authApiBinding,
    authzApiBinding,
    automationsApiBinding,
    dataPrivacyApiBinding,
    dataRetentionApiBinding,
    datasetApiBinding,
    evaluatorApiBinding,
    gatewayApiBinding,
    githubApiBinding,
    governanceApiBinding,
    modelProviderApiBinding,
    monitorApiBinding,
    navigationApiBinding,
    opsApiBinding,
    organizationApiBinding,
    promptApiBinding,
    secretApiBinding,
    traceApiBinding,
    workflowApiBinding,
    ...personalWorkspaceApiBindings,
  ],
  capabilities: { feedback: BrowserUiFeedback.create() },
  session: useBrowserUiSession,
};

/**
 * The host's install, over this package's own.
 *
 * Additive where a list makes that meaningful and last-wins where one answer is
 * all there is: a host that brings its own toaster gets its own toaster, and a
 * host that brings its own loader for a key this package also serves wins the
 * key. The host is the more specific composition, so it is the one that decides
 * — the merge inside `createUiApplication` then puts the result ahead of the
 * host's own legacy registry, which is a different question and answered there.
 */
export function mergeUiFeatureInstalls(
  installed: UiFeatureInstall,
  host: UiFeatureInstall = {},
): UiFeatureInstall {
  return {
    loaders: { ...installed.loaders, ...host.loaders },
    apis: [...(installed.apis ?? []), ...(host.apis ?? [])],
    capabilities: { ...installed.capabilities, ...host.capabilities },
    ...((host.transport ?? installed.transport)
      ? { transport: host.transport ?? installed.transport }
      : {}),
    ...((host.session ?? installed.session) ? { session: host.session ?? installed.session } : {}),
  };
}
