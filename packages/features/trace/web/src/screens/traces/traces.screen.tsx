/**
 * The Trace Explorer, as a screen.
 *
 * `platform/app`'s page was `DashboardLayout` plus `withPermissionGuard` around
 * `TracesPage`, and neither half travelled: chrome belongs to the route tree
 * and the grant is stated in `apps/ui`'s route section, in front of the loader,
 * exactly as every family since governance has stated it. What is left is the
 * explorer itself.
 */

import { TracesPage } from "../../ui/sections/explorer/traces-page";

export default function TracesScreen() {
  return <TracesPage />;
}
