/**
 * What the composition root takes from auth, organization, analytics, navigation, trace and
 * ops, loaded through their declarations before anything renders (ARCHITECTURE.md 10.1).
 */

import { analyticsWeb } from "@langwatch/analytics-browser/declaration";
import { authWeb } from "@langwatch/auth-browser/declaration";
import { createDesignSystem } from "@langwatch/design-system/system";
import { navigationWeb } from "@langwatch/navigation-browser/declaration";
import { opsWeb } from "@langwatch/ops-browser/declaration";
import { organizationWeb } from "@langwatch/organization-browser/declaration";
import { traceWeb } from "@langwatch/trace-browser/declaration";

import { langyThemeConfig } from "./ui/elements/langy/langy-theme.ts";

const auth = authWeb.installation.capabilities;
const organization = organizationWeb.installation.capabilities;
const analytics = analyticsWeb.installation.capabilities;
const navigation = navigationWeb.installation.capabilities;
const trace = traceWeb.installation.capabilities;
const ops = opsWeb.installation.capabilities;

export type UiRootHostServices = {
  session: Awaited<ReturnType<typeof auth.session.load>>;
  frontDoorTheme: Awaited<ReturnType<typeof auth.frontDoorTheme.load>>;
  authHost: Awaited<ReturnType<typeof auth.host.load>>;
  scope: Awaited<ReturnType<typeof organization.scope.load>>;
  organizationFacts: Awaited<ReturnType<typeof organization.organizationFacts.load>>;
  copyTargets: Awaited<ReturnType<typeof organization.copyTargets.load>>;
  traceFilters: Awaited<ReturnType<typeof analytics.traceFilters.load>>;
  navigationHost: Awaited<ReturnType<typeof navigation.host.load>>;
  navigationChrome: Awaited<ReturnType<typeof navigation.chrome.load>>;
  commandBar: Awaited<ReturnType<typeof navigation.commandBar.load>>;
  presenceMenuItem: Awaited<ReturnType<typeof trace.presenceMenuItem.load>>;
  impersonationBanner: Awaited<ReturnType<typeof ops.impersonationBanner.load>>;
  upgradeBanner: Awaited<ReturnType<typeof ops.upgradeBanner.load>>;
};

export async function loadUiRootHostServices(): Promise<UiRootHostServices> {
  const [
    session,
    frontDoorTheme,
    authHost,
    scope,
    organizationFacts,
    copyTargets,
    traceFilters,
    navigationHost,
    navigationChrome,
    commandBar,
    presenceMenuItem,
    impersonationBanner,
    upgradeBanner,
  ] = await Promise.all([
    auth.session.load(),
    auth.frontDoorTheme.load(),
    auth.host.load(),
    organization.scope.load(),
    organization.organizationFacts.load(),
    organization.copyTargets.load(),
    analytics.traceFilters.load(),
    navigation.host.load(),
    navigation.chrome.load(),
    navigation.commandBar.load(),
    trace.presenceMenuItem.load(),
    ops.impersonationBanner.load(),
    ops.upgradeBanner.load(),
  ]);
  return {
    session,
    frontDoorTheme,
    authHost,
    scope,
    organizationFacts,
    copyTargets,
    traceFilters,
    navigationHost,
    navigationChrome,
    commandBar,
    presenceMenuItem,
    impersonationBanner,
    upgradeBanner,
  };
}

/** The application-composed system: shared foundations plus installed features. */
export function composeUiDesignSystem({
  frontDoorTheme,
}: Pick<UiRootHostServices, "frontDoorTheme">) {
  return createDesignSystem(langyThemeConfig, frontDoorTheme.frontDoorThemeConfig);
}
