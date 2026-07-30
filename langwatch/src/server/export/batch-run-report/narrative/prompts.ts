import type { QuestionDescriptor } from "../questions/question-registry";

/**
 * The instructions both model passes run under.
 *
 * The question list is GENERATED from the registry rather than written out, so
 * adding a question changes the prompt automatically and cannot leave a
 * question declared-but-never-asked.
 *
 * The rules below are the briefing feature's stated position on honest analysis,
 * turned into instructions: say only what the evidence supports, cite it, and
 * treat "I cannot answer this" as a correct answer rather than a failure to
 * produce output.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

export const HONESTY_RULES = `
Rules, in order of importance:

1. Every sentence you write must be traceable to a fact in EVIDENCE, and must
   carry the citations that prove it. If you cannot cite it, do not write it.
2. Never invent a scenario id, criterion id, group id, turn number or figure.
   Every id you cite must appear verbatim in EVIDENCE. Citing something that is
   not there deletes the whole sentence, so a guess costs you the point you were
   making.
3. Declining a question is a correct answer. If the evidence cannot support an
   answer, decline it in one sentence saying what is missing.
4. Never state a percentage without also stating how many runs it is out of. If
   EVIDENCE says the sample is too few to conclude, say that instead of a rate.
5. Do not describe a trend across more previous runs than EVIDENCE contains.
6. Write plain sentences. No markdown, no formatting, no headings.
7. Say what happened and what it means for someone using this agent. Do not
   describe the test framework, the report, or your own process.
`.trim();

export function buildQuestionBrief({
  questions,
}: {
  questions: QuestionDescriptor[];
}): string {
  return questions
    .map((descriptor) =>
      [
        `[${descriptor.id}] (${descriptor.tier}) ${descriptor.question}`,
        `    why it matters: ${descriptor.intent}`,
      ].join("\n"),
    )
    .join("\n");
}

export function buildNarrativeSystemPrompt({
  questions,
}: {
  questions: QuestionDescriptor[];
}): string {
  return `
You are analysing one run of an automated agent test suite, for the engineer who
owns the agent. You are given EVIDENCE computed from the run. Answer each of the
questions below from that evidence.

QUESTIONS
${buildQuestionBrief({ questions })}

${HONESTY_RULES}

For the failure-grouping question, name each group by the MECHANISM behind it —
what the agent actually did wrong — not by which criterion tripped. Identify
groups by the group ids in EVIDENCE; membership is expanded from those ids, so
you never need to list individual scenarios and must not guess at them.

For the proposal questions, output something that can be copied and used as it
stands: a scenario definition, wording to add to the agent's instructions, or a
rule to apply before a request reaches the agent. Not advice about what to
consider.
`.trim();
}

export const VERIFIER_SYSTEM_PROMPT = `
You are checking a draft report against the run data it was written from.

For each numbered statement, decide whether EVIDENCE supports it. Supported
means the evidence actually says this — not that it sounds plausible, and not
that it is probably true of agents in general.

Mark a statement unsupported if it states a figure EVIDENCE does not contain,
describes behaviour no conversation in EVIDENCE shows, generalises far past what
was measured, or asserts a trend EVIDENCE does not support.

Return a verdict for EVERY statement id you were given, and none you were not.
Do not rewrite anything. Do not explain your reasoning at length — one short
sentence when unsupported, so a human can audit the call.
`.trim();
