/**
 * The one way a red team pack writes an attack scenario, so every pack carries the same shape and
 * the same strategy and turn defaults.
 * @see modules/suite/specs/suite-templates.feature
 */

import type { SuiteTemplateScenario } from "@langwatch/suite-contract";

type AttackBody = {
  name: string;
  situation: string;
  criteria: string[];
  attackGoal: string;
  strategy?: "crescendo" | "goat";
  maxTurns?: number;
};

/** An attack named after one OWASP entry: the id is its key, its name prefix and its OWASP id. */
export type OwaspEntryAttack = AttackBody & { id: string };

/** An attack with its own key that covers the OWASP ids it names. */
export type KeyedAttack = AttackBody & { key: string; owaspIds: string[] };

export function redTeamAttack(
  input: (OwaspEntryAttack | KeyedAttack) & { labels: string[] },
): SuiteTemplateScenario {
  const { situation, criteria, labels, attackGoal, strategy = "crescendo", maxTurns = 30 } = input;
  const entry =
    "id" in input
      ? { key: input.id.toLowerCase(), name: `${input.id} ${input.name}`, owaspIds: [input.id] }
      : { key: input.key, name: input.name, owaspIds: input.owaspIds };
  return {
    key: entry.key,
    name: entry.name,
    situation,
    criteria,
    labels,
    attack: { attackGoal, owaspIds: entry.owaspIds, strategy, maxTurns },
  };
}
