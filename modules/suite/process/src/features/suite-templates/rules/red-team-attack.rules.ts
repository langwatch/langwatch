/**
 * The one way a red team pack writes an attack scenario, so every pack carries the same shape and
 * the same strategy and turn defaults.
 * @see modules/suite/specs/suite-templates.feature
 */

import { OWASP_CATEGORIES } from "@langwatch/scenario-contract";
import type { SuiteTemplateScenario } from "@langwatch/suite-contract";

type AttackBody = {
  name: string;
  /** What the agent needs beyond chat for the attack to mean anything; shown in the situation. */
  needs?: string;
  situation: string;
  criteria: string[];
  attackGoal: string;
  strategy?: "crescendo" | "goat";
  maxTurns?: number;
};

/** An attack for one OWASP entry: the id is its key and OWASP id; its name is the official one. */
export type OwaspEntryAttack = Omit<AttackBody, "name"> & { id: string };

/** An attack with its own key that covers the OWASP ids it names. */
export type KeyedAttack = AttackBody & { key: string; owaspIds: string[] };

export function redTeamAttack(
  input: (OwaspEntryAttack | KeyedAttack) & { labels: string[] },
): SuiteTemplateScenario {
  const { criteria, labels, attackGoal, strategy = "crescendo", maxTurns = 30 } = input;
  const situation = input.needs ? `${input.situation} Needs: ${input.needs}.` : input.situation;
  const entry =
    "id" in input
      ? {
          key: input.id.toLowerCase(),
          name: `${input.id} ${OWASP_CATEGORIES[input.id] ?? input.id}`,
          owaspIds: [input.id],
        }
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
