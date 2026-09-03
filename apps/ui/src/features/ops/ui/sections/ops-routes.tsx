/**
 * Which page key each Ops address answers: `ops:view` for the workspace,
 * `ops:manage` for the Backoffice, deliberately decoupled. A refusal
 * renders in place, not a redirect — that would hide the address exists.
 */

import { opsScreens, type BackofficeResource } from "@langwatch/ops-web/screens/ops";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { OPS_MANAGE_PERMISSION, OPS_VIEW_PERMISSION, OpsHost } from "./ops-host";

type OpsScreenName = keyof typeof opsScreens;

/** One Ops page: the host outside, the operator grant inside. */
function opsPage(screen: OpsScreenName): UiPageLoader {
  return uiPage({
    screen: async () => ({ default: (await opsScreens[screen]()).default as ComponentType }),
    host: OpsHost,
    permission: OPS_VIEW_PERMISSION,
  });
}

/** One Backoffice resource, behind the narrower grant. */
function backofficePage(resource: BackofficeResource): UiPageLoader {
  return uiPage({
    screen: async () => {
      const module = await opsScreens.backoffice();
      const Screen = module.default as ComponentType<{ resource?: BackofficeResource }>;
      const OnResource = () => <Screen resource={resource} />;
      OnResource.displayName = `BackofficePage(${resource})`;
      return { default: OnResource };
    },
    host: OpsHost,
    permission: OPS_MANAGE_PERMISSION,
  });
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
