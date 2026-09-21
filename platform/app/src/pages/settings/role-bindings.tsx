import { Navigate } from "react-router";

/**
 * Role Bindings became the second tab of Roles.
 *
 * The page asked a reader to learn a word only this codebase says, and stood a
 * whole navigation entry away from the roles it listed. Its address keeps
 * resolving so old bookmarks, notification links and support threads do not
 * dead-end, and it lands on the tab it used to be rather than on the roles.
 *
 * A page that renders `<Navigate>`, not a `loader` redirect: loaders do not
 * run on a cold load of the SPA, which is exactly how a stale link arrives.
 */
export default function RoleBindingsRedirect() {
  return <Navigate to="/settings/roles?tab=assignments" replace />;
}
