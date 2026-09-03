/**
 * Which page keys the two handoff addresses answer, and what they are wrapped in.
 *
 * TWO KEYS, TWO SCREENS, ONE FRAME: the host, and nothing else.
 *
 * NEITHER KEY CARRIES A PAGE-LEVEL GRANT, and that is the platform pages' policy
 * one for one. `/authorize` was `DashboardLayout` and a card; it refuses nothing,
 * because a reader without `project:update` is answered with an empty key by the
 * server rather than refused by the page — and refusing them outright would deny
 * a reader the product admits today. `/mcp/authorize` had no guard either: it
 * does its own session redirect, carrying the OAuth parameters through so the
 * reader lands back on the grant they were asked for, which a permission guard
 * would pre-empt by refusing before the redirect could run.
 *
 * `DashboardLayout` did not travel with either. Both addresses sit inside the
 * chrome layout route, which draws the header once above every page this package
 * serves; the switcher those pages put in their own card header arrives through
 * the host port instead, because on a consent screen it is the control that says
 * what is being consented to.
 */

import { authorizeScreens } from "@langwatch/api-key-web/screens/authorize";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { withAuthorizeHost } from "./authorize-host-provider";

const authorizePage: UiPageLoader = async () => {
  const module = await authorizeScreens.authorize();
  return { default: withAuthorizeHost(module.default) };
};

const mcpAuthorizePage: UiPageLoader = async () => {
  const module = await authorizeScreens.mcpAuthorize();
  return { default: withAuthorizeHost(module.default) };
};

export const authorizePageLoaders: UiPageLoaderRegistry = {
  "pages/authorize": authorizePage,
  "pages/mcp/authorize": mcpAuthorizePage,
};
