import { Navigate } from "react-router";

/**
 * Authentication became the account-owned Security page. Keep the old address
 * alive for bookmarks and links from older deployments, but do not leave a
 * second settings implementation behind.
 */
export default function AuthenticationSettingsRedirect() {
  return <Navigate to="/settings/security" replace />;
}
