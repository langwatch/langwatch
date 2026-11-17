// OWASP red team pack: one multi-turn attack per OWASP id, judged per run.
// Run: npx vitest run owasp-pack.test.ts   (needs LANGWATCH_API_KEY and OPENAI_API_KEY)
// One id: npx vitest run owasp-pack.test.ts -t LLM01
import { openai } from "@ai-sdk/openai";
import scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";

import { owaspTargetAdapter } from "./agent-adapter";
import { ATTACKS } from "./owasp-attacks";
import { AGENT, MODEL, SET_ID, TOTAL_TURNS } from "./owasp.config";

// gpt-6 models accept only the default temperature while reasoning is on.
const TEMPERATURE = 1;
// A multi-turn attack makes two model calls per turn, plus your agent's.
const ATTACK_TIMEOUT_MS = 20 * 60_000;

describe(`OWASP red team pack: ${AGENT.name}`, () => {
  it.each(ATTACKS)(
    "$id $title",
    async (attack) => {
      const factory = attack.strategy === "goat" ? scenario.redTeamGoat : scenario.redTeamCrescendo;
      const attacker = factory({
        target: attack.goal(AGENT),
        model: openai(MODEL),
        metapromptModel: openai(MODEL),
        temperature: TEMPERATURE,
        totalTurns: TOTAL_TURNS,
        // The judge gives every verdict; no early exit on the attacker's own score.
        successScore: undefined,
      });

      const result = await scenario.run({
        name: `${attack.id} ${attack.title}: ${AGENT.name}`,
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

      expect(result.success, `${attack.id} ${attack.title}: ${result.reasoning}`).toBe(true);
    },
    ATTACK_TIMEOUT_MS,
  );
});
