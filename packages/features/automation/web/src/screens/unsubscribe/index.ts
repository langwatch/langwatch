/**
 * The unsubscribe landing, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/unsubscribe`. Its own entry rather than a second
 * loader under `./screens/automations`, because it shares nothing with that
 * family but the transport: no session, no scope, no host, no chrome, and
 * nobody who opens it is signed in.
 *
 * WHY THIS PACKAGE. The credentials family's rule, read strictly: a key belongs
 * to the family that owns its TRANSPORT. Both calls are `emailSuppression.*`,
 * mounted out of `@langwatch/automation-server`, and the view they answer with
 * is `AutomationService`'s own. The notification feature — which is what the
 * page is ABOUT — publishes no web package and owns neither call, so naming it
 * would be a guess about a future move rather than a reading of this one. The
 * settings half of the same transport, `/settings/email-suppressions`, has not
 * moved and is recorded in the manifest as automation's when it does.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on, and the token out of the query string. There is NO
 * host port and NO page guard: the token is the authorization (ADR-031), so a
 * guard would refuse the only person the link was minted for.
 */

import type { ComponentType } from "react";

export type UnsubscribeScreenLoader = () => Promise<{
  default: ComponentType<{ token: string }>;
}>;

export const unsubscribeScreens = {
  unsubscribe: () => import("./unsubscribe.screen"),
} as const satisfies Record<string, UnsubscribeScreenLoader>;

export type UnsubscribeScreenName = keyof typeof unsubscribeScreens;

export type { UnsubscribeScope } from "./unsubscribe.screen";
export { automationApi } from "../../behavior/automation-api";
