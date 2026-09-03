/**
 * Which page key each Ops address answers, and what it is wrapped in.
 *
 * The route table names TWENTY page keys under `/ops` and the package exposes
 * FOURTEEN screens, because the six Backoffice addresses were always one page:
 * `platform/app` had six three-line files, each rendering a resource view inside
 * one shared admin-gated shell. This is the map between the two vocabularies,
 * and it makes the resource explicit — a key names a resource here, so the
 * screen is told rather than having to read the address. That is the shape the
 * automations family established for its four tabs.
 *
 * Each page is wrapped twice, and the order matters. The host provider is
 * OUTSIDE the guard: a refusal renders the guard's own fallback, which asks
 * nothing of the Ops host, but a page that opens needs the host mounted above it
 * before its first render. Inside that, the guard states the policy the platform
 * page shells carried.
 *
 * THE POLICY IS THE PLATFORM SHELLS', ONE FOR ONE, AND IT IS TWO POLICIES.
 * `OpsPageShell` gated the workspace on the live `ops.getScope` probe and
 * `BackofficeShell` gated the Backoffice on `user.isAdmin`, decoupled on purpose
 * so widening operator access could never widen the Backoffice. Here they are
 * the two platform-tier grants the authz registry already declares: `ops:view`
 * for the workspace, `ops:manage` for the Backoffice. A reader with the first
 * and not the second sees every Ops page and is refused every Backoffice one.
 *
 * WHAT DOES NOT TRAVEL is the redirect. Both platform shells pushed a denied
 * reader to `/`; the guard renders a refusal in place instead, which is what
 * every family before this one did and what a page guard is for — a redirect
 * hides from the reader that the address exists and they may not see it.
 *
 * `DashboardLayout` and `SettingsLayout` were the other half of those shells and
 * do not travel either: chrome belongs to the route tree.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import { opsScreens, type BackofficeResource } from "@langwatch/ops-web/screens/ops";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { OPS_MANAGE_PERMISSION, OPS_VIEW_PERMISSION } from "../../behavior/ops-host.adapter";
import { withOpsHost } from "./ops-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

type OpsScreenName = keyof typeof opsScreens;

/** One Ops page: the host outside, the operator grant inside. */
function opsPage(screen: OpsScreenName): UiPageLoader {
  return async () => {
    const module = await opsScreens[screen]();
    const guarded = withUiPageGuard({
      permission: OPS_VIEW_PERMISSION,
      fallbacks: FALLBACKS,
    })(module.default as ComponentType);
    return { default: withOpsHost(guarded) };
  };
}

/** One Backoffice resource, behind the narrower grant. */
function backofficePage(resource: BackofficeResource): UiPageLoader {
  return async () => {
    const module = await opsScreens.backoffice();
    const Screen = module.default as ComponentType<{ resource?: BackofficeResource }>;
    const OnResource = () => <Screen resource={resource} />;
    OnResource.displayName = `BackofficePage(${resource})`;
    const guarded = withUiPageGuard({
      permission: OPS_MANAGE_PERMISSION,
      fallbacks: FALLBACKS,
    })(OnResource);
    return { default: withOpsHost(guarded) };
  };
}

export const opsPageLoaders: UiPageLoaderRegistry = {
  "pages/ops/index": opsPage("dashboard"),
  "pages/ops/dejaview": opsPage("dejaView"),
  "pages/ops/event-sourcing/index": opsPage("eventSourcing"),
  "pages/ops/event-sourcing/dead-letters": opsPage("deadLetters"),
  "pages/ops/event-sourcing/processes": opsPage("processes"),
  "pages/ops/event-sourcing/projections": opsPage("projections"),
  "pages/ops/event-sourcing/subscribers": opsPage("subscribers"),
  "pages/ops/event-sourcing/schedules": opsPage("schedules"),
  "pages/ops/blobs": opsPage("payloadStore"),
  "pages/ops/feature-flags": opsPage("featureFlags"),
  "pages/ops/foundry": opsPage("foundry"),
  "pages/ops/migrations": opsPage("migrations"),
  "pages/ops/projections/[runId]": opsPage("replayProgress"),
  "pages/ops/backoffice/bug-reports": backofficePage("bug-reports"),
  "pages/ops/backoffice/users": backofficePage("users"),
  "pages/ops/backoffice/organizations": backofficePage("organizations"),
  "pages/ops/backoffice/projects": backofficePage("projects"),
  "pages/ops/backoffice/subscriptions": backofficePage("subscriptions"),
  "pages/ops/backoffice/sso-connections": backofficePage("sso-connections"),
};
