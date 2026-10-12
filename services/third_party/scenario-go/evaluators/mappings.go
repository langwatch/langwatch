package evaluators

import (
	"context"
	"strings"

	scenario "github.com/langwatch/scenario/go"
	"github.com/langwatch/scenario/go/internal/jsjson"
)

// StateMapping is a mapping helper: a function of the scenario state that
// names the state expression it stands for. Use it as a mapping value.
type StateMapping struct {
	// Expression is the state expression the helper stands for, for example
	// `state.field("golden_sql")`.
	Expression string
	// Read reads the value; nil means nothing.
	Read scenario.MappingFunc
}

func sugar(expression string, read func(s *scenario.ExecutionState) any) StateMapping {
	return StateMapping{Expression: expression, Read: func(_ context.Context, s *scenario.ExecutionState) (any, error) {
		return read(s), nil
	}}
}

// orNil turns "" into nil, the JS `|| undefined`.
func orNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Conversation holds the inputs that read the conversation of the run.
var Conversation = struct {
	// FirstUserMessage is the text of the first message the simulated user sent.
	FirstUserMessage StateMapping
	// LastAgentMessage is the text of the last message the agent under test sent.
	LastAgentMessage StateMapping
	// Transcript is the whole conversation as "role: content" lines.
	Transcript StateMapping
	// Messages is the whole conversation as a list of messages.
	Messages StateMapping
}{
	FirstUserMessage: sugar("state.firstUserMessage() || undefined", func(s *scenario.ExecutionState) any {
		return orNil(s.FirstUserMessage())
	}),
	LastAgentMessage: sugar("messageText(state.lastAgentMessage())", func(s *scenario.ExecutionState) any {
		m, err := s.LastAgentMessage()
		if err != nil {
			return nil
		}
		return scenario.MessageText(m)
	}),
	Transcript: sugar("state.transcript()", func(s *scenario.ExecutionState) any { return s.Transcript() }),
	Messages:   sugar("state.messages", func(s *scenario.ExecutionState) any { return s.Messages() }),
}

// ScenarioSource holds the inputs that read the scenario definition.
var ScenarioSource = struct {
	// Situation is the scenario description.
	Situation StateMapping
	// Criteria are the judge criteria, one per line.
	Criteria StateMapping
}{
	Situation: sugar("state.description", func(s *scenario.ExecutionState) any { return s.Description() }),
	Criteria: sugar(`state.criteria.join("\n")`, func(s *scenario.ExecutionState) any {
		return strings.Join(s.Criteria(), "\n")
	}),
}

// Field reads one field of the scenario, for example Field("golden_sql"). A
// scenario that leaves the field blank skips the evaluator with the reason
// "no golden_sql on this scenario".
func Field(name string) StateMapping {
	return sugar("state.field("+jsjson.Stringify(name)+")", func(s *scenario.ExecutionState) any {
		v, ok := s.Field(name)
		if !ok {
			return nil
		}
		return v
	})
}

// ToolCallPick reads the input and the output of one tool call.
type ToolCallPick struct {
	// Input is the arguments of the call.
	Input StateMapping
	// Output is the result of the call.
	Output StateMapping
}

// ToolCallsMapping holds the picks and columns over the calls of one tool.
type ToolCallsMapping struct {
	First   ToolCallPick
	Last    ToolCallPick
	Inputs  StateMapping
	Outputs StateMapping
}

type traceMappings struct {
	// Contexts is every chunk the agent retrieved, across the run.
	Contexts StateMapping
	// Spans is every span of every trace of the run, in start order.
	Spans StateMapping
}

// ToolCalls reads the calls of one tool across the run, from the assistant
// messages and the tool spans. ToolCalls("run_sql").Last.Input is the
// arguments of the last call; a run without that call skips the evaluator
// with the reason "no run_sql call in the trace".
func (traceMappings) ToolCalls(name string) ToolCallsMapping {
	calls := "state.toolCalls(" + jsjson.Stringify(name) + ")"
	pick := func(which string, get func(scenario.ToolCalls) (scenario.RunToolCall, bool)) ToolCallPick {
		read := func(output bool) func(s *scenario.ExecutionState) any {
			return func(s *scenario.ExecutionState) any {
				c, ok := get(s.ToolCalls(name))
				switch {
				case !ok:
					return nil
				case output:
					return c.Output
				}
				return c.Input
			}
		}
		return ToolCallPick{
			Input:  sugar(calls+"."+which+"?.input", read(false)),
			Output: sugar(calls+"."+which+"?.output", read(true)),
		}
	}
	return ToolCallsMapping{
		First:   pick("first", scenario.ToolCalls.First),
		Last:    pick("last", scenario.ToolCalls.Last),
		Inputs:  sugar(calls+".inputs", func(s *scenario.ExecutionState) any { return s.ToolCalls(name).Inputs() }),
		Outputs: sugar(calls+".outputs", func(s *scenario.ExecutionState) any { return s.ToolCalls(name).Outputs() }),
	}
}

// Trace holds the inputs that read evidence from the traces of the run.
var Trace = traceMappings{
	Contexts: sugar("state.contexts", func(s *scenario.ExecutionState) any { return s.Contexts() }),
	Spans:    sugar("state.spans", func(s *scenario.ExecutionState) any { return s.Spans() }),
}

// Value is an input that takes a literal string, number or bool. A literal
// can also be written directly in the mappings.
func Value(literal any) StateMapping {
	return StateMapping{Expression: jsjson.Stringify(normalizeNumber(literal)), Read: func(context.Context, *scenario.ExecutionState) (any, error) {
		return literal, nil
	}}
}

// Option configures an evaluator attachment.
type Option func(*scenario.ScenarioEvaluator)

// Required sets whether a failing verdict fails the scenario. Unset, it
// defaults to true for pass/fail evaluators and false for score-only ones.
func Required(required bool) Option {
	return func(e *scenario.ScenarioEvaluator) { e.Required = &required }
}

// Map says where one input reads from: a StateMapping, a
// scenario.MappingFunc, a func(*scenario.ExecutionState) any, or a literal
// string, number or bool.
func Map(input string, mapping any) Option {
	return func(e *scenario.ScenarioEvaluator) {
		if e.Mappings == nil {
			e.Mappings = map[string]any{}
		}
		e.Mappings[input] = mapping
	}
}

// Settings overrides the evaluator settings for this run.
func Settings(settings map[string]any) Option {
	return func(e *scenario.ScenarioEvaluator) { e.Settings = settings }
}

// Evaluator attaches a LangWatch evaluator to a scenario run: a built-in
// type such as "ragas/sql_query_equivalence", or a saved evaluator as
// "evaluators/<slug>". Unmapped inputs are inferred from their names.
func Evaluator(ref string, opts ...Option) scenario.ScenarioEvaluator {
	e := scenario.ScenarioEvaluator{Evaluator: ref}
	for _, opt := range opts {
		opt(&e)
	}
	return e
}
