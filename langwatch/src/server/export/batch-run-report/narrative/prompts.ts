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
   making. A "run" citation's runId must be one of the run_id values listed
   under ## SCENARIOS or ## CONVERSATIONS — never the suite name from ## RUN,
   which is not a run and cannot be cited as one.
3. Declining a question is a correct answer. If the evidence cannot support an
   answer, decline it in one sentence saying what is missing.
4. Never state a percentage without also stating how many runs it is out of. If
   EVIDENCE says the sample is too few to conclude, say that instead of a rate.
5. Do not describe a trend across more previous runs than EVIDENCE contains.
6. Write plain sentences. No markdown, no formatting, no headings. Name a
   scenario by its scenario name, never by its run id — the citation carries
   the id, so an id in the sentence is the same string twice and the half a
   reader cannot read. "Checkout flow failed", not
   "run_3GoiQDRJOWcnsy1 failed".
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

Respond with a single JSON object shaped exactly like this — an "answers" array,
one entry per question id, never a top-level object keyed by question id:

{"answers":[{"questionId":"past.outcome","declined":false,
"statements":[{"text":"One sentence, citing evidence.",
"citations":[{"kind":"run","runId":"the exact id from EVIDENCE"}]}]}]}

A question you decline still gets its own entry: {"questionId":"...",
"declined":true,"declinedReason":"why, in one sentence"}.

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

/**
 * Whether a prompt satisfies OpenAI-compatible APIs' own requirement: a
 * request using `response_format: json_object` 400s unless the word "json"
 * appears somewhere in the messages. Both system prompts here are what get
 * sent as those messages, so this is checked at module load — a prompt edit
 * that drops the word fails every report silently (a fast, generic-looking
 * 400) rather than failing loudly at the one place it can be caught cheaply.
 */
export function mentionsJson(text: string): boolean {
  return /\bjson\b/i.test(text);
}

export const VERIFIER_SYSTEM_PROMPT = `
You are checking a draft report against the run data it was written from.

For each numbered statement, decide whether EVIDENCE supports it. Supported
means the evidence actually says this — not that it sounds plausible, and not
that it is probably true of agents in general.

Mark a statement unsupported if it states a figure EVIDENCE does not contain,
describes behaviour no conversation in EVIDENCE shows, generalises far past what
was measured, or asserts a trend EVIDENCE does not support.

A statement whose id starts with "future." proposes a fix — a scenario, a line
of agent instructions, a guardrail rule — rather than describing what happened.
Judge those by their citations, not by their wording: they are supported when
every citation is real and the proposal is a direct response to the failure it
points at. A proposal's own text (the scenario, the instruction, the rule) is
new by construction and will never itself appear in EVIDENCE — that is not a
reason to mark it unsupported. Mark a proposal unsupported only when a citation
does not exist, or the proposal has no real connection to what its citations
show (for example, it addresses a failure the citations do not describe).

Return a verdict for EVERY statement id you were given, and none you were not.
Do not rewrite anything. Do not explain your reasoning at length — one short
sentence when unsupported, so a human can audit the call.

Respond with a single JSON object shaped exactly like this — a "verdicts"
array, one entry per statement id, never a top-level object keyed by statement
id and never a string status in place of the boolean:

{"verdicts":[{"claimId":"the exact id you were given","supported":true},
{"claimId":"another id","supported":false,"reason":"why, in one sentence"}]}
`.trim();

function assertPromptsSupportJsonMode(): void {
  const narrativePrompt = buildNarrativeSystemPrompt({ questions: [] });
  if (!mentionsJson(narrativePrompt)) {
    throw new Error(
      "buildNarrativeSystemPrompt() no longer mentions 'json' — OpenAI-compatible providers reject a json_object response_format request whose messages don't contain the word.",
    );
  }
  if (!mentionsJson(VERIFIER_SYSTEM_PROMPT)) {
    throw new Error(
      "VERIFIER_SYSTEM_PROMPT no longer mentions 'json' — OpenAI-compatible providers reject a json_object response_format request whose messages don't contain the word.",
    );
  }
}
assertPromptsSupportJsonMode();
