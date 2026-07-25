import { Navigate } from "react-router";

/**
 * The devices inventory lived here before it was renamed, and the docs and
 * old bookmarks still point at this path, so it forwards instead of
 * dead-ending on the 404 page.
 */
export default function MeSessionsRedirect() {
  return <Navigate to="/me/devices" replace />;
}
