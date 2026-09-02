/**
 * The product switcher, as this application answers it.
 *
 * `@langwatch/navigation-web` owns the control — which products the reader can
 * reach, what each one's home is, and the pitch line under each row. What
 * belongs here is the one thing the control cannot know: WHICH PRODUCT THE
 * CURRENT ADDRESS BELONGS TO. That is `resolveShellRoute`, the package's own
 * resolver, asked with the two scope facts this application already holds.
 *
 * The settings detour is not a product, and neither is an address the resolver
 * cannot place, so both render nothing rather than marking a product the reader
 * is not in.
 */

import {
  ProductSwitcherMenu,
  resolveShellRoute,
  useOptionalNavigationHost,
} from "@langwatch/navigation-web/chrome";
import { useLocation } from "react-router";

export function UiProductSwitcher() {
  // Optional for the same reason the project switcher's read is: this control
  // is chrome, and chrome renders where the layout route reaches.
  const host = useOptionalNavigationHost();
  const { pathname } = useLocation();
  if (!host) return null;

  const project = host.project();
  const { activeProductId } = resolveShellRoute({
    pathname,
    // The application resolves scope from the address and its own memory; a
    // personal workspace is the one project kind that is not the organization's.
    isPersonalScope: project?.isPersonal === true,
    isOrgScope: !project,
    isOnOwnPersonalProject: project?.isPersonal === true,
  });

  if (!activeProductId) return null;

  return <ProductSwitcherMenu activeProductId={activeProductId} />;
}
