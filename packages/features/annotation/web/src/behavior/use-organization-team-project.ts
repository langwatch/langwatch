/**
 * The scope reading the annotation queue walker already makes, answered by the
 * host.
 *
 * `useOrganizationTeamProject` is the application's hook and a feature-web
 * package may not import it. The walker reads exactly two things off it —
 * `project` and `hasPermission` — so keeping the NAME and the SHAPE is what let
 * 810 lines of screen and two suites travel without an edit; what changed is
 * where the answer comes from.
 *
 * The application's hook also redirected to onboarding and bounced a reader
 * with no organization. That is landing policy, it belongs to whatever serves
 * the address, and it did not travel — the options object is accepted and
 * ignored so a call site that passed one still compiles.
 */

import { useAnnotationHost } from "../model/annotation-host";

export function useOrganizationTeamProject(_options?: {
  redirectToProjectOnboarding?: boolean;
  redirectToOnboarding?: boolean;
}) {
  const host = useAnnotationHost();
  return {
    project: host.project(),
    hasPermission: (permission: string) => host.hasPermission(permission),
  };
}
