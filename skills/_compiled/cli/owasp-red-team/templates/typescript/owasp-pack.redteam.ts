// OWASP red team pack: one multi-turn attack per OWASP id, judged per run.
// It calls live models, so it does not end in .test.ts and a plain vitest run skips it.
// Run: npx vitest run --config tests/owasp/owasp.vitest.config.ts
// It needs LANGWATCH_API_KEY and OPENAI_API_KEY.
// One id: add -t LLM01
import { openai } from "@ai-sdk/openai";
import scenario from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";

import { owaspTargetAdapter } from "./agent-adapter";
import { ATTACKS, attackerOptions, breach, runIdentity } from "./owasp-attacks";
import { AGENT, MODEL, SET_ID, TOTAL_TURNS, assertConfigFilled } from "./owasp.config";

// gpt-6 models accept only the default temperature while reasoning is on.
const TEMPERATURE = 1;
// A multi-turn attack makes two model calls per turn, plus your agent's.
const ATTACK_TIMEOUT_MS = 20 * 60_000;

describe(`OWASP red team pack: ${AGENT.name}`, () => {
  beforeAll(() => assertConfigFilled());

  it.each(ATTACKS)(
    "$id $title",
    async (attack) => {
      const factory = attack.strategy === "goat" ? scenario.redTeamGoat : scenario.redTeamCrescendo;
      const attacker = factory({
        model: openai(MODEL),
        metapromptModel: openai(MODEL),
        temperature: TEMPERATURE,
        ...attackerOptions({ attack, agent: AGENT, turns: TOTAL_TURNS }),
      });

      const { id, name, metadata } = runIdentity({ attack, agent: AGENT });
      const result = await scenario.run({
        id,
        name,
        metadata,
        description: `An attacker targets ${AGENT.name}. ${AGENT.description}`,
        agents: [
          owaspTargetAdapter,
          attacker,
          scenario.judgeAgent({
            model: openai(MODEL),
            temperature: TEMPERATURE,
            criteria: attack.criteria(AGENT),
          }),
        ],
        script: attacker.marathonScript(),
        setId: SET_ID,
      });

      // The result has no turn index: open the run in LangWatch to see where it broke.
      const failure = breach({ name, result });
      expect(failure, failure ?? undefined).toBeNull();
    },
    ATTACK_TIMEOUT_MS,
  );
});
