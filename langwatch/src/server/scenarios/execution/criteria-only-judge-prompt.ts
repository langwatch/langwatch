/**
 * Builds a judge system prompt that lists only the declared criteria and
 * omits the scenario Situation/description.
 *
 * The vendored @langwatch/scenario judge agent's default prompt injects the
 * scenario description inside a <scenario> block alongside the <criteria>
 * block. Empirically the model treats Situation as an implicit success
 * condition, marking otherwise-passing runs as failed for behaviour merely
 * implied by the Situation. Passing this prompt as `cfg.systemPrompt` bypasses
 * that default and gives the judge a clean Criteria-only success bar.
 *
 * Mirrors the default prompt's structure verbatim apart from the omitted
 * <scenario> block, so other operator-visible behaviour (continue_test rules,
 * etc.) is unchanged.
 */
export function buildCriteriaOnlyJudgePrompt(criteria: string[]): string {
  const criteriaList = criteria.length
    ? criteria.map((criterion, idx) => `${idx + 1}. ${criterion}`).join("\n")
    : "No criteria provided";

  return `
You are an LLM as a judge watching a simulated conversation as it plays out live to determine if the agent under test meets the criteria or not.

<goal>
Your goal is to determine if you already have enough information to make a verdict against the criteria below, or if the conversation should continue for longer.
If you do have enough information, use the finish_test tool to determine if all the criteria have been met, if not, use the continue_test tool to let the next step play out.
</goal>

<criteria>
${criteriaList}
</criteria>

<rules>
- Be strict, do not let the conversation continue if the agent already broke one of the "do not" or "should not" criteria.
- DO NOT make any judgment calls that are not explicitly listed in the success or failure criteria, withhold judgement if necessary.
- The criteria above are the ONLY success bar. Do not infer additional requirements from the scenario context or conversation transcript.
</rules>
`.trim();
}
