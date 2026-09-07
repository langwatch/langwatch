import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * "May this reader START a conversation?" — the other half of Langy's
 * permission pair.
 *
 * `useShowLangy` gates on `langy:view`, which is READ. Starting a turn needs
 * `langy:create`, enforced server-side by `langyCreateProcedure` in
 * `routers/langy.ts`. Those are genuinely different grants, and until now the
 * gap was survivable only because the panel is opt-in: a read-only member had
 * to go looking for the composer before it could fail them.
 *
 * A composer at the top of the home page removes that protection — it is the
 * first thing they touch, and a send would come back 403. So the surface that
 * puts a composer in front of someone asks this first and offers a read-only
 * presentation instead. This is a CLIENT-side courtesy over a server-side
 * rule: the server is still the authority, this only stops us inviting people
 * into a door that is locked.
 *
 * Spec: specs/home/langy-home.feature
 */
export function useCanAskLangy(): boolean {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  return hasPermission("langy:create");
}
