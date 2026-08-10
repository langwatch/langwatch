import { Navigate } from "react-router";

/**
 * The devices inventory lives in a tab of the configure page, next to the
 * personal keys, and the docs and old bookmarks still point at this path, so
 * it forwards instead of dead-ending on the 404 page.
 */
export default function MeDevicesRedirect() {
  return <Navigate to="/me/configure" replace />;
}
