/**
 * What this package serves itself: `createUiApplication` merges the host's
 * install over this standing declaration. Sits at the features root — this
 * registry and the package entry are the only places allowed to import a feature.
 */

import { BrowserUiFeedback } from "../behavior/ui-feedback";
import { useBrowserUiSession } from "../behavior/ui-session";
import type { UiFeatureInstall } from "../ui/sections/ui-application";
import { agentApiBinding, agentPageLoaders } from "./agent";
import { analyticsApiBinding, analyticsPageLoaders } from "./analytics";
import { apiKeyApiBinding, apiKeyPageLoaders } from "./api-key";
import { annotationApiBinding, annotationPageLoaders } from "./annotation";
import { annotationScoresApiBinding, annotationScoresPageLoaders } from "./annotation-scores";
import { authApiBinding, authPageLoaders } from "./auth";
import { authorizePageLoaders } from "./authorize";
import { authzApiBinding, authzPageLoaders } from "./authz";
import { billingApiBinding, billingPageLoaders } from "./billing";
import { chromePageLoaders } from "./chrome";
import { automationsAllPageLoaders, automationsApiBinding } from "./automations";
import { dataPrivacyApiBinding, dataPrivacyPageLoaders } from "./data-privacy";
import { dataRetentionApiBinding, dataRetentionPageLoaders } from "./data-retention";
import { datasetApiBinding, datasetPageLoaders } from "./dataset";
import { evaluationPageLoaders } from "./evaluations";
import { evaluatorApiBinding, evaluatorPageLoaders } from "./evaluator";
import { experimentPageLoaders } from "./experiments";
import { gatewayApiBinding, gatewayPageLoaders } from "./gateway";
import { githubApiBinding, githubPageLoaders } from "./github";
import { governanceApiBinding, governancePageLoaders } from "./governance";
import { homeApiBinding, homePageLoaders } from "./home";
import { langyApiBinding, langyPageLoaders } from "./langy";
import { licensingApiBinding, licensingPageLoaders } from "./licensing";
import { modelProviderApiBinding, modelProviderPageLoaders } from "./model-provider";
import { navigationApiBinding, navigationPageLoaders } from "./navigation";
import { notificationApiBinding, notificationPageLoaders } from "./notification";
import { monitorApiBinding, monitorPageLoaders } from "./monitor";
import { onboardingApiBinding, onboardingPageLoaders } from "./onboarding";
import { opsApiBinding, opsPageLoaders } from "./ops";
import { organizationApiBinding, organizationPageLoaders } from "./organization";
import { projectApiBinding, projectPageLoaders } from "./project";
import { promptApiBinding, promptPageLoaders } from "./prompt";
import { scimApiBinding, scimPageLoaders } from "./scim";
import { secretApiBinding, secretPageLoaders } from "./secret";
import { simulationsApiBinding, simulationsPageLoaders } from "./simulations";
import { topicApiBinding, topicPageLoaders } from "./topic";
import { traceApiBinding, tracePageLoaders } from "./traces";
import { workflowApiBinding, workflowPageLoaders } from "./workflows";
import { personalWorkspaceApiBindings, personalWorkspacePageLoaders } from "./personal-workspace";

export const installedUiFeatures: UiFeatureInstall = {
  loaders: {
    ...agentPageLoaders,
    ...analyticsPageLoaders,
    ...annotationPageLoaders,
    ...annotationScoresPageLoaders,
    ...apiKeyPageLoaders,
    ...authPageLoaders,
    ...authorizePageLoaders,
    ...authzPageLoaders,
    ...billingPageLoaders,
    ...chromePageLoaders,
    ...automationsAllPageLoaders,
    ...dataPrivacyPageLoaders,
    ...dataRetentionPageLoaders,
    ...datasetPageLoaders,
    ...evaluationPageLoaders,
    ...evaluatorPageLoaders,
    ...experimentPageLoaders,
    ...gatewayPageLoaders,
    ...githubPageLoaders,
    ...governancePageLoaders,
    ...homePageLoaders,
    ...langyPageLoaders,
    ...licensingPageLoaders,
    ...modelProviderPageLoaders,
    ...navigationPageLoaders,
    ...notificationPageLoaders,
    ...monitorPageLoaders,
    ...onboardingPageLoaders,
    ...opsPageLoaders,
    ...organizationPageLoaders,
    ...projectPageLoaders,
    ...promptPageLoaders,
    ...scimPageLoaders,
    ...secretPageLoaders,
    ...simulationsPageLoaders,
    ...topicPageLoaders,
    ...tracePageLoaders,
    ...workflowPageLoaders,
    ...personalWorkspacePageLoaders,
  },
  apis: [
    agentApiBinding,
    analyticsApiBinding,
    annotationApiBinding,
    annotationScoresApiBinding,
    apiKeyApiBinding,
    authApiBinding,
    authzApiBinding,
    automationsApiBinding,
    billingApiBinding,
    dataPrivacyApiBinding,
    dataRetentionApiBinding,
    datasetApiBinding,
    evaluatorApiBinding,
    gatewayApiBinding,
    githubApiBinding,
    governanceApiBinding,
    homeApiBinding,
    langyApiBinding,
    licensingApiBinding,
    modelProviderApiBinding,
    monitorApiBinding,
    navigationApiBinding,
    notificationApiBinding,
    onboardingApiBinding,
    opsApiBinding,
    organizationApiBinding,
    projectApiBinding,
    promptApiBinding,
    scimApiBinding,
    secretApiBinding,
    simulationsApiBinding,
    topicApiBinding,
    traceApiBinding,
    workflowApiBinding,
    ...personalWorkspaceApiBindings,
  ],
  capabilities: { feedback: BrowserUiFeedback.create() },
  session: useBrowserUiSession,
};
