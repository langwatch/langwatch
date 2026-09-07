import { Navigate } from "react-router";

/**
 * Directory sync became the Directory.
 *
 * The page was named after the protocol that fills it, and the surface is
 * named for what it holds now. Its address keeps resolving so old bookmarks,
 * identity-provider runbooks and support threads do not dead-end.
 *
 * A page that renders `<Navigate>`, not a `loader` redirect: loaders do not
 * run on a cold load of the SPA, which is exactly how a stale link arrives.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export default function ScimRedirect() {
  return <Navigate to="/settings/directory" replace />;
}
