// Package evaluators runs LangWatch evaluators on scenario runs, next to the
// judge verdict: a built-in evaluator ("langevals/exact_match",
// "ragas/sql_query_equivalence", ...) or one saved in LangWatch
// ("evaluators/<slug>").
//
// The core package only carries the declarations
// (scenario.ScenarioConfig.Evaluators); this package runs them. Register its
// runner once per process, before the first run, or set
// ScenarioConfig.EvaluatorRunner on a single scenario. Without a runner the
// declared evaluators do not run. This registration is a Go difference: the
// JavaScript SDK runs evaluators without it, but the Go core package never
// imports its subpackages.
//
//	scenario.Configure(scenario.WithEvaluatorRunner(evaluators.NewRunner()))
//
// Each evaluator input reads from the scenario state through a mapping:
//
//   - Conversation.FirstUserMessage, .LastAgentMessage, .Transcript, .Messages
//   - ScenarioSource.Situation (the description) and .Criteria
//   - Field("golden_sql") reads ScenarioConfig.Fields
//   - Trace.ToolCalls("run_sql").Last.Input (or .First, .Inputs, .Outputs),
//     merged from tool call messages and tool spans; Trace.Contexts and
//     Trace.Spans
//   - Value(literal), or a literal string, number or bool
//   - a scenario.MappingFunc or func(*scenario.ExecutionState) any
//
// Inputs left unmapped are inferred from their names (output reads the last
// agent message, expected_output a field such as expected_answer, ...). A
// mapped input that finds nothing skips the evaluator with a reason, such as
// "no run_sql call in the trace". A required evaluator that fails, or cannot
// run, fails the scenario; Required defaults to true for pass/fail
// evaluators and false for score-only ones. Results land in
// scenario.ScenarioResult.Evaluations.
//
//	func TestSQLAgent(t *testing.T) {
//		scenario.Configure(scenario.WithEvaluatorRunner(evaluators.NewRunner()))
//
//		result, err := scenario.Run(ctx, scenario.ScenarioConfig{
//			Name:        "chargebacks per quarter",
//			Description: "An analyst asks for the chargebacks per quarter of ACME Travel.",
//			Agents:      []scenario.AgentAdapter{sqlAgent, userSim, judge},
//			Fields: map[string]scenario.FieldValue{
//				"golden_sql": "SELECT quarter, count(*) FROM chargebacks GROUP BY quarter",
//			},
//			Evaluators: []scenario.ScenarioEvaluator{
//				evaluators.Evaluator("ragas/sql_query_equivalence",
//					evaluators.Map("output", evaluators.Trace.ToolCalls("run_sql").Last.Input),
//					evaluators.Map("expected_output", evaluators.Field("golden_sql")),
//				),
//				evaluators.Evaluator("langevals/llm_boolean",
//					evaluators.Required(false),
//					evaluators.Settings(map[string]any{"prompt": "Is the answer polite?"}),
//				),
//			},
//		})
//		if err != nil {
//			t.Fatal(err)
//		}
//		for _, e := range result.Evaluations {
//			t.Logf("%s: %s %s", e.EvaluatorID, e.Status, e.Details)
//		}
//	}
//
// The evaluators need LANGWATCH_API_KEY (and LANGWATCH_ENDPOINT for a
// self-hosted platform), or the run's scenario.LangWatchConfig. When a mapping
// reads the trace and finds nothing, the runner first waits for the remote
// traces of the run, as the judge does.
package evaluators
