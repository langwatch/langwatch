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
import { automationsApiBinding, automationsPageLoaders } from "./automations";
import { gatewayApiBinding, gatewayPageLoaders } from "./gateway";
import { governanceApiBinding, governancePageLoaders } from "./governance";
import { personalWorkspaceApiBindings, personalWorkspacePageLoaders } from "./personal-workspace";

export const installedUiFeatures: UiFeatureInstall = {
  loaders: {
    ...automationsPageLoaders,
    ...gatewayPageLoaders,
    ...governancePageLoaders,
    ...personalWorkspacePageLoaders,
  },
  apis: [
    automationsApiBinding,
    gatewayApiBinding,
    governanceApiBinding,
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
