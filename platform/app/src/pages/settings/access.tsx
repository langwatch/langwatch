import { Navigate } from "react-router";

/**
 * Access was a page named after the thing every page in this cluster is about.
 *
 * It held two switches, and a reader could not tell from the word which two.
 * Each went where the thing it governs lives: who may join without an
 * invitation is now under the people it would admit, on Directory; the
 * second-factor requirement is a condition of signing in and is now on
 * Authentication, beside the session policy. A domain is proved in exactly one
 * place — the connection that rests on it — so the second proof flow this page
 * drew is gone rather than duplicated.
 *
 * A page that renders `<Navigate>`, not a `loader` redirect: loaders do not
 * run on a cold load of the SPA, which is exactly how a stale link arrives.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export default function AccessRedirect() {
  return <Navigate to="/settings/directory" replace />;
}
