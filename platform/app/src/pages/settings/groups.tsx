import { Navigate } from "react-router";

/**
 * Groups became the second tab of Directory.
 *
 * A group is the thing an identity provider sends and the thing an
 * administrator grants a role to, and it had a navigation entry of its own a
 * click away from the page that reports whether the directory sent it. Its
 * address keeps resolving so old bookmarks and support threads do not
 * dead-end, and it lands on the tab it used to be rather than on the status.
 *
 * A page that renders `<Navigate>`, not a `loader` redirect: loaders do not
 * run on a cold load of the SPA, which is exactly how a stale link arrives.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export default function GroupsRedirect() {
  return <Navigate to="/settings/directory?tab=groups" replace />;
}
