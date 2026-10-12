package scenario

import (
	"strconv"
	"strings"
)

// The judge prompt text is verbatim from the JS SDK (judge-agent.ts and
// criterion-verdicts.ts); the Python SDK uses the same strings.

const remoteTraceJudgingRule = "Criteria about the agent's internal behavior (tool calls, database writes, API calls, retrievals) must be verified against the <opentelemetry_traces> section, not against claims in the transcript. If a span named langwatch.span_collection.error is present, read its reason: when no agent spans arrived, mark criteria that depend on internal behavior as inconclusive, never passed. When the trace is incomplete, criteria proven by the spans that are present may pass, and criteria whose evidence is missing stay inconclusive. Criteria about the conversation itself are unaffected by missing traces: judge them from the transcript as normal. Never mark internal-behavior criteria as passed based on the transcript alone."

const decisionPhaseRule = "In this step, only decide whether the conversation has collected enough information to evaluate the criteria: call make_verdict when it has, or continue_test to let the conversation play out. Do not decide whether the criteria pass or fail now: that evaluation happens in a separate step after the conversation ends."

const remoteTraceDecisionRule = "The agent's execution traces are fetched and verified at the verdict, after the conversation ends; they are not part of this decision. Do not continue the conversation only to wait for trace evidence, and do not end it early to see traces sooner."

// Field descriptions of the finish_test tool.
const (
	requirementDescription        = "This criterion restated as a positive requirement the agent must satisfy. A fail condition such as 'fail if X', 'fail only if X', 'pass unless X' or 'the agent must not X' becomes 'the agent does not X'."
	criterionReasoningDescription = "What the conversation and the collected evidence show about this requirement alone, pointing at the moment that decides it. Written before the status. When the status is inconclusive, name the evidence that was missing."
	statusDescription             = "passed: the agent satisfied the requirement (for a fail condition, the condition did not happen). failed: the agent did not satisfy it (for a fail condition, the condition happened). inconclusive: the evidence to decide is not available."
	summaryDescription            = "A short summary of the verdict across all criteria, written after judging each one."
)

// perCriterionRules are the verdict prompt's rules on judging criteria one
// by one.
var perCriterionRules = [...]string{
	"Judge each criterion on its own: restate it as a positive requirement, check the conversation and the collected evidence for that requirement alone, write the reasoning, then choose its status. The outcome of one criterion never decides another.",
	`passed means the agent satisfied the requirement. A criterion phrased as a fail condition ("fail if X", "fail only if X", "pass unless X", "the agent must not X") passes when X did not happen and fails when X happened.`,
	"When the evidence to decide a criterion is not available (the conversation ended before the moment it depends on, or it depends on internal behavior that left no trace), mark it inconclusive and name the missing evidence in its reasoning instead of guessing.",
}

// Tool descriptions.
const (
	continueTestDescription  = "Continue the test with the next step"
	makeVerdictDescription   = "The conversation has collected enough information to evaluate the criteria. End the conversation and move to the verdict."
	waitForTracesDescription = "The remote trace evidence is still incomplete and the missing spans are essential for the verdict. Wait one more period for them to arrive. Available once: after this wait the verdict must be delivered on the evidence at hand. Only call this when a criterion genuinely depends on the missing spans; otherwise deliver the verdict now."
	finishTestDescription    = "Complete the test with a verdict on each criterion, judged one by one"
	expandTraceDescription   = "Expand one or more spans to see their full details (attributes, events, content). Use the span ID shown in brackets in the trace skeleton."
	grepTraceDescription     = "Search across all span attributes, events, and content for a pattern (case-insensitive). Returns matching spans with context."
)

// Follow-up instructions of the verdict phase.
const (
	discoveryExhaustedPrompt = "You have reached the maximum number of trace exploration steps. " +
		"Based on the information you have gathered so far, give your final verdict now."
	waitedOncePrompt = "You already waited once more for the remote traces. The trace evidence above is final: deliver your verdict now."
)

func buildCriteriaList(criteria []string) string {
	if len(criteria) == 0 {
		return "No criteria provided"
	}
	var b strings.Builder
	for i, c := range criteria {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(strconv.Itoa(i + 1))
		b.WriteString(". ")
		b.WriteString(c)
	}
	return b.String()
}

// buildDecisionSystemPrompt is the prompt of the decision phase, which
// carries no verdict vocabulary so nothing pre-commits the judge.
func buildDecisionSystemPrompt(criteria []string, description string, fetchRemoteTraces bool) string {
	remoteRule := ""
	if fetchRemoteTraces {
		remoteRule = "\n- " + remoteTraceDecisionRule
	}
	return strings.TrimSpace(`
<role>
You are an LLM as a judge watching a simulated conversation as it plays out live to decide if it has collected enough information to evaluate the agent under test.
</role>

<goal>
Your goal is to decide if the conversation has collected enough information to evaluate the criteria, or if it should continue for longer. Do not decide whether the criteria pass or fail now: that evaluation happens in a separate step after the conversation ends. If enough information has been collected, call the make_verdict tool; if not, call the continue_test tool to let the next step play out.
</goal>

<scenario>
` + description + `
</scenario>

<criteria>
` + buildCriteriaList(criteria) + `
</criteria>

<rules>
- Call make_verdict as soon as the agent has clearly broken one of the "do not" or "should not" criteria; more conversation cannot repair a violation.
- Scenario simulations exist to exercise multi-turn conversations: while the conversation is still short, lean towards continuing, and end it only when more turns would clearly add no information for the criteria.` + remoteRule + `
</rules>
`)
}

// buildVerdictSystemPrompt is the prompt of the verdict phase.
func buildVerdictSystemPrompt(criteria []string, description string, fetchRemoteTraces bool) string {
	remoteRule := ""
	if fetchRemoteTraces {
		remoteRule = "\n- " + remoteTraceJudgingRule
	}
	rules := make([]string, len(perCriterionRules))
	for i, r := range perCriterionRules {
		rules[i] = "- " + r
	}
	return strings.TrimSpace(`
<role>
You are an LLM as a judge delivering the final verdict on a simulated conversation, determining if the agent under test meets the criteria or not.
</role>

<goal>
Your goal is to deliver the final verdict of the scenario below with the finish_test tool, judging each criterion on its own against the conversation and the collected evidence.
</goal>

<scenario>
` + description + `
</scenario>

<criteria>
` + buildCriteriaList(criteria) + `
</criteria>

<rules>
- Be strict: a criterion passes only when the conversation or the collected evidence clearly shows it was met.
- DO NOT make any judgment calls that are not explicitly listed in the success or failure criteria, withhold judgement if necessary
` + strings.Join(rules, "\n") + remoteRule + `
</rules>
`)
}

// buildJudgeContent is the user message the judge evaluates.
func buildJudgeContent(transcript, digest, additionalContextSection string) string {
	var b strings.Builder
	b.Grow(len(transcript) + len(digest) + len(additionalContextSection) + 128)
	b.WriteString("\n    <transcript>\n    ")
	b.WriteString(transcript)
	b.WriteString("\n    </transcript>\n    <opentelemetry_traces>\n    ")
	b.WriteString(digest)
	b.WriteString("\n    </opentelemetry_traces>")
	b.WriteString(additionalContextSection)
	b.WriteString("\n    ")
	return b.String()
}

func additionalContextSection(text string) string {
	if text == "" {
		return ""
	}
	return "\n    <additional_context>\n    " + text + "\n    </additional_context>"
}
