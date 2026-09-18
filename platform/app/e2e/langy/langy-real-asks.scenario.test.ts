// Scenarios derived from asks REAL users sent Langy, mined from the dogfood
// project's own traces (`project_6FujhzZ3VwRlZl01TE9os`) rather than invented
// at a desk. Provenance, the exact corpus counts and the per-ask evidence are
// in `langy-real-asks.md`.
//
// READ THIS BEFORE TRUSTING A CRITERION BELOW.
//
// The corpus is 20 traces / 11 conversations / ~2 days, and only 4 of those 20
// traces captured Langy's ANSWER. So the scenarios split into two classes, and
// each one below says which it is:
//
//   OBSERVED  — both the ask and Langy's answer are in the corpus. The criteria
//               are written against behaviour that actually happened, so the
//               scenario is a regression pin.
//   SPECIFIED — the ask is real and quoted verbatim, but Langy's answer was
//               NOT captured. The criteria are my specification of what a good
//               answer looks like. These may fail on first run, and a failure
//               is a finding to adjudicate, not necessarily a bug.
//
// No criterion here asserts anything about Langy's MECHANICS — which tool it
// called, whether it searched traces. The corpus carries zero spans (0/20), so
// there is no evidence for that class of claim. Everything asserted below is
// observable in the reply text itself.
//
// Run exactly like the rest of the suite:
//   cd platform/app/e2e/langy
//   npx vitest run langy-real-asks.scenario.test.ts --reporter=verbose

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import { makeLangyAdapter } from "./langy-agent";
import { LANGY_CORE_RULE_CRITERIA } from "./langy-rules";
import { runScenarioAndLog } from "./scenario-logger";

const model = openai("gpt-5-mini");

describe("Langy on real user asks", () => {
  // OBSERVED — langyconv_0007F7chgdezG0kgTQDLy6Hqph7kf, turn 1.
  // Langy answered, verbatim: "No off-topic evaluator traces in last 24h."
  // followed by "Off-topic quality is unmonitored: no online monitor exists,
  // and the configured evaluators do not assess topicality."
  // The second sentence is the whole point — a bare empty result is the failure.
  it("diagnoses an empty result instead of just reporting it", async () => {
    const result = await runScenarioAndLog({
      name: "empty result is diagnosed",
      description:
        "The user asks for off-topic evaluator traces on a project where no " +
        "monitor assesses topicality, so the honest answer is empty. The user " +
        "wants to know why it is empty, not merely that it is.",
      agents: [
        makeLangyAdapter(),
        scenario.userSimulatorAgent({ model }),
        scenario.judgeAgent({
          model,
          criteria: [
            "When the search returns nothing, Langy says WHY it is empty — for example that no online monitor is bound, or that the configured evaluators do not assess this property.",
            "A reply that reports only 'no results' or 'no traces found', with no explanation of the cause, is a FAILURE.",
            "Langy does not present the empty result as though the feature were working and simply had no matches, when in fact nothing is measuring it.",
            ...LANGY_CORE_RULE_CRITERIA,
          ],
        }),
      ],
      script: [
        // Verbatim from the trace, including the non-breaking space before
        // "what's" that the real user's message carried.
        scenario.user(
          "I want to see all of the off topic evaluator traces AND what's related",
        ),
        scenario.agent(),
        scenario.judge(),
      ],
    });
    expect(result.success).toBe(true);
  });

  // OBSERVED — langyconv_0007F7chgdezG0kgTQDLy6Hqph7kf, turn 2.
  // "what about the last 30 days?" names no subject at all. Langy answered
  // "No off-topic evaluator traces in the last 30 days." — it re-ran the SAME
  // query on the new window. Asking "the last 30 days of what?" is the failure
  // this pins.
  it("carries scope across a subject-less follow-up", async () => {
    const result = await runScenarioAndLog({
      name: "cross-turn scope carry",
      description:
        "The user runs a query, then asks a follow-up that names a new time " +
        "window and nothing else. The subject must be carried from the " +
        "previous turn.",
      agents: [
        makeLangyAdapter(),
        scenario.userSimulatorAgent({ model }),
        scenario.judgeAgent({
          model,
          criteria: [
            "On the second turn Langy re-runs the SAME query as the first turn, changed only to the newly named time window.",
            "Langy does NOT ask what 'the last 30 days' refers to — the subject is carried from the previous turn.",
            "The second answer explicitly names the new window, so the user can tell it was applied.",
            ...LANGY_CORE_RULE_CRITERIA,
          ],
        }),
      ],
      script: [
        scenario.user(
          "I want to see all of the off topic evaluator traces AND what's related",
        ),
        scenario.agent(),
        scenario.user("what about the last 30 days?"),
        scenario.agent(),
        scenario.judge(),
      ],
    });
    expect(result.success).toBe(true);
  });

  // SPECIFIED — langyconv_0007Q4qJlI5TqeM18QnikIeWjWH0T (asked twice, 2 traces).
  // The ask is verbatim; Langy's answer was NOT captured on either trace, so
  // the criteria below are my specification, not an observation.
  //
  // "Is it possible to…" is a question about the PRODUCT, not a query over the
  // user's data. Both refusing it as out-of-scope and answering it with a data
  // lookup are wrong. The criteria judge the REPLY — they deliberately do not
  // assert which tool ran, because no span evidence exists to ground that.
  it("answers a capability question about the product, not about the user's data", async () => {
    const result = await runScenarioAndLog({
      name: "capability question",
      description:
        "The user asks whether a LangWatch feature exists. There is nothing " +
        "in their project data that answers this.",
      agents: [
        makeLangyAdapter(),
        scenario.userSimulatorAgent({ model }),
        scenario.judgeAgent({
          model,
          criteria: [
            "Langy answers whether the capability exists in LangWatch — a direct yes or no.",
            "If it exists, Langy says where it lives or how it is configured. If it does not, Langy says so plainly.",
            "The answer is about how the PRODUCT works. Reporting counts, traces or metrics from the user's own project does not answer this question and is a FAILURE.",
            "Langy does NOT refuse this as out of scope — how the product works is squarely in scope.",
            ...LANGY_CORE_RULE_CRITERIA,
          ],
        }),
      ],
      script: [
        scenario.user("Is it possible to set experiments to run on a schedule?"),
        scenario.agent(),
        scenario.judge(),
      ],
    });
    expect(result.success).toBe(true);
  });

  // SPECIFIED — langyconv_0003oPew2MUUI3XonIkPvZlrPwl7r, a SINGLE turn with no
  // captured answer. The user's message is verbatim; everything the criteria
  // demand of Langy is my specification. In particular the second exchange
  // below never happened in the corpus — it is how I claim the flow should go.
  //
  // The ask is worth pinning because it collides with a core rule: the user
  // EXPLICITLY instructs Langy to ask them a question, while
  // LANGY_CORE_RULE_CRITERIA says "does NOT ask the user a clarifying
  // question". An explicit instruction has to outrank the default, so the core
  // rubric is deliberately NOT spread in here — same carve-out shape as
  // LANGY_EVAL_CREATION_CRITERIA in langy-rules.ts.
  it("obeys an explicit instruction to ask, overriding the no-questions rule", async () => {
    const result = await runScenarioAndLog({
      name: "explicit instruction to ask wins",
      description:
        "A new user wants onboarding steps and explicitly tells Langy to ask " +
        "what their agent is built with first, so the steps can be specific.",
      agents: [
        makeLangyAdapter(),
        scenario.userSimulatorAgent({ model }),
        scenario.judgeAgent({
          model,
          criteria: [
            "Langy DOES ask what the user's agent is built with, because the user explicitly asked it to — the default no-clarifying-questions rule yields to an explicit instruction.",
            "Langy asks that question BEFORE giving the setup steps, not after.",
            "Once the user names their stack, Langy gives concrete setup steps specific to that stack — not a generic walkthrough that ignores the answer.",
            "The steps are exact enough to follow: the package to install and the call to make, not a pointer to 'see the docs'.",
            "Langy does NOT ask more than the one question it was told to ask.",
          ],
        }),
      ],
      script: [
        scenario.user(
          "Walk me through sending my first trace to this project. Ask me what my agent is built with, then give me the exact steps.",
        ),
        scenario.agent(),
        scenario.user("It's a TypeScript app using the Vercel AI SDK."),
        scenario.agent(),
        scenario.judge(),
      ],
    });
    expect(result.success).toBe(true);
  });
});
