import { type PropsWithChildren } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";

/**
 * AI Gateway section layout. Thin wrapper over `DashboardLayout compactMenu`
 * — the gateway sub-nav lives in the main left icon rail as an expandable
 * CollapsibleMenuGroup (see `MainMenu.tsx`), not inline on every page.
 *
 * History:
 * - iter 15: introduced as a standalone HStack that REPLACED DashboardLayout
 *   — made gateway look like a grafted-on standalone app (finding 4).
 * - iter 24: wrapped in DashboardLayout so dashboard chrome shows.
 * - iter 29: sub-nav lifted into MainMenu's CollapsibleMenuGroup. This file
 *   is now just a marker component so every gateway page stays discoverable
 *   in a single grep.
 */
export function GatewayLayout({ children }: PropsWithChildren) {
  return <DashboardLayout compactMenu>{children}</DashboardLayout>;
}
