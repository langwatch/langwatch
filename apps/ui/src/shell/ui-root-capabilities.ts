/**
 * What the composition root takes from auth, organization, navigation and trace, loaded through
 * their declarations before anything renders (ARCHITECTURE.md 10.1).
 */

import { authWeb } from "@langwatch/auth-browser/declaration";
import { navigationWeb } from "@langwatch/navigation-browser/declaration";
import { organizationWeb } from "@langwatch/organization-browser/declaration";
import { traceWeb } from "@langwatch/trace-browser/declaration";

const auth = authWeb.installation.capabilities;
const organization = organizationWeb.installation.capabilities;
const navigation = navigationWeb.installation.capabilities;
const trace = traceWeb.installation.capabilities;

export type UiRootCapabilities = {
  session: Awaited<ReturnType<typeof auth.session.load>>;
  frontDoorTheme: Awaited<ReturnType<typeof auth.frontDoorTheme.load>>;
  authHost: Awaited<ReturnType<typeof auth.host.load>>;
  scope: Awaited<ReturnType<typeof organization.scope.load>>;
  organizationFacts: Awaited<ReturnType<typeof organization.organizationFacts.load>>;
  copyTargets: Awaited<ReturnType<typeof organization.copyTargets.load>>;
  navigationHost: Awaited<ReturnType<typeof navigation.host.load>>;
  navigationChrome: Awaited<ReturnType<typeof navigation.chrome.load>>;
  commandBar: Awaited<ReturnType<typeof navigation.commandBar.load>>;
  presenceMenuItem: Awaited<ReturnType<typeof trace.presenceMenuItem.load>>;
};

export async function loadUiRootCapabilities(): Promise<UiRootCapabilities> {
  const [
    session,
    frontDoorTheme,
    authHost,
    scope,
    organizationFacts,
    copyTargets,
    navigationHost,
    navigationChrome,
    commandBar,
    presenceMenuItem,
  ] = await Promise.all([
    auth.session.load(),
    auth.frontDoorTheme.load(),
    auth.host.load(),
    organization.scope.load(),
    organization.organizationFacts.load(),
    organization.copyTargets.load(),
    navigation.host.load(),
    navigation.chrome.load(),
    navigation.commandBar.load(),
    trace.presenceMenuItem.load(),
  ]);
  return {
    session,
    frontDoorTheme,
    authHost,
    scope,
    organizationFacts,
    copyTargets,
    navigationHost,
    navigationChrome,
    commandBar,
    presenceMenuItem,
  };
}
