import { Navigate } from "react-router";

/**
 * Teams & Projects became a tab of Directory.
 *
 * A team is a container people sit in, and it had a navigation entry beside
 * the list of those same people — so a reader had to know in advance whether
 * what they were looking for was a person or the thing holding them. Both
 * answer "who is here". Its address keeps resolving so old bookmarks and
 * support threads do not dead-end, and it lands on the tab it used to be.
 *
 * A page that renders `<Navigate>`, not a `loader` redirect: loaders do not
 * run on a cold load of the SPA, which is exactly how a stale link arrives.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export default function TeamsRedirect() {
  return <Navigate to="/settings/directory?tab=teams" replace />;
}
