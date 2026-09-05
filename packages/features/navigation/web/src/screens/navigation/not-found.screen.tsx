/**
 * The page for an address that names nothing.
 *
 * Moved from `platform/app/src/pages/not-found.tsx`, which wrapped the scene in
 * `DashboardLayout`. It carries no chrome of its own here: the application's
 * chrome route already draws the header and the sidebar around every page it
 * serves, and a screen that framed itself again would give this address two.
 */

import { NotFoundScene } from "../../ui/sections/not-found-scene";

export default function NotFoundScreen() {
  return <NotFoundScene />;
}
