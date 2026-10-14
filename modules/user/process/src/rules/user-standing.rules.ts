/** One of user's standing facts on its own lifecycle log. */
export type UserStandingFact = Readonly<{
  type: "deactivated" | "reactivated";
  occurredAt: number;
}>;

/**
 * Whether user's own log leaves the account deactivated, folded as authz folds it: the latest
 * instant wins and a deactivation tied with a reactivation stays deactivated.
 */
export function isHeldDeactivated({ facts }: { facts: readonly UserStandingFact[] }): boolean {
  const latest = (type: UserStandingFact["type"]) =>
    Math.max(-Infinity, ...facts.filter((fact) => fact.type === type).map((f) => f.occurredAt));
  const deactivated = latest("deactivated");

  return deactivated !== -Infinity && deactivated >= latest("reactivated");
}
