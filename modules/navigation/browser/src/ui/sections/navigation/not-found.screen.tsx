/**
 * The page for an address that names nothing — carries no chrome of its
 * own, since the application's chrome route already draws the header
 * and sidebar around every page it serves.
 */

import { NotFoundScene } from "../../../ui/sections/not-found-scene.tsx";

export default function NotFoundScreen() {
  return <NotFoundScene />;
}
