# Scenario Go SDK

![scenario](https://github.com/langwatch/scenario/raw/refs/heads/main/assets/scenario-wide.webp)

Test AI agents with simulated users and an LLM judge, in realistic, scripted
multi-turn scenarios. The Go SDK follows the JavaScript SDK: same script DSL,
same judge, same events and traces in [LangWatch](https://langwatch.ai).

## Features

- **Provider agnostic**: any model behind the small `scenario.LLM` interface;
  adapters for OpenAI, Anthropic, Gemini and Bedrock in separate modules
- **Scripted or simulated conversations**: `User()`, `Agent()`, `Judge()`,
  `Proceed()`, `Succeed()`, `Fail()` and your own steps
- **Two-phase judge** with a verdict per criterion (passed, failed,
  inconclusive), reading both the transcript and the OpenTelemetry spans of
  your agent
- **Multimodal messages**: text, images, files and audio
- **LangWatch**: live events and traces of every run
- **`go test` native**: runs are independent and safe under `t.Parallel()`

## Installation

```bash
go get github.com/langwatch/scenario/go
go get github.com/langwatch/scenario/go/providers/openai   # or anthropic, gemini, bedrock
```

## Quick start

```go
package myagent_test

import (
	"context"
	"testing"

	"github.com/openai/openai-go/v3"
	scenario "github.com/langwatch/scenario/go"
	scenarioopenai "github.com/langwatch/scenario/go/providers/openai"
)

func TestGreeting(t *testing.T) {
	t.Parallel()
	client := openai.NewClient() // OPENAI_API_KEY
	model := scenario.ModelConfig{LLM: scenarioopenai.NewProvider(&client), Model: "gpt-4.1-mini"}

	agent := scenario.AgentFunc(func(ctx context.Context, in scenario.AgentInput) (*scenario.AgentReturn, error) {
		return scenario.TextReturn("Hello! How can I help you today?"), nil
	})

	result, err := scenario.Run(context.Background(), scenario.ScenarioConfig{
		Name:        "greeting",
		Description: "The user says hello to a customer support agent",
		Agents: []scenario.AgentAdapter{
			agent,
			scenario.NewUserSimulatorAgent(scenario.UserSimulatorAgentConfig{ModelConfig: model}),
			scenario.NewJudgeAgent(scenario.JudgeAgentConfig{
				ModelConfig: model,
				Criteria:    []string{"The agent greets the user", "The agent offers help"},
			}),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success {
		t.Fatalf("scenario failed: %s", result.Reasoning)
	}
}
```

Without a script the scenario runs `Proceed()`: the user simulator, your
agent and the judge take turns until the judge decides or `MaxTurns` (10) is
reached.

Set a process-wide default model once instead of on every agent:

```go
scenario.Configure(scenario.WithDefaultModel(model))
```

## Scripts

```go
Script: []scenario.ScriptStep{
	scenario.User("i need to change my flight"), // fixed user message
	scenario.Agent(),                             // your agent answers
	scenario.User(),                              // the simulator writes the next message
	scenario.Agent(),
	scenario.StepFunc(func(ctx context.Context, ex *scenario.Executor) error {
		return scenario.Assert(ex.State().HasToolCall("lookup_booking"), "agent looked up the booking")
	}),
	scenario.Judge(scenario.WithCriteria("The agent asks for the booking reference")), // checkpoint
	scenario.Proceed(scenario.Turns(3)),
	scenario.Judge(), // final verdict on the judge's own criteria
},
```

| Step | Meaning |
|------|---------|
| `User(text...)` / `Agent(text...)` | add a fixed message, or let the simulator / your agent produce one |
| `MessageStep(msg)` | inject any message (tool calls, tool results, system) |
| `Judge(opts...)` | verdict now; `WithCriteria` makes it a checkpoint, `WithAdditionalContext` adds evidence |
| `Proceed(Turns(n), OnTurn(f), OnStep(f))` | let the agents converse |
| `Succeed(reason)` / `Fail(reason)` | end the scenario |
| `StepFunc(fn)` | your own step; return `scenario.Assert(...)` for checks |

`ScriptStep` is an interface (`Run(ctx, *Executor) error`), so packages can
add their own steps.

## Agents

```go
type AgentAdapter interface {
	Role() AgentRole // AgentRoleAgent, AgentRoleUser or AgentRoleJudge
	Call(ctx context.Context, input AgentInput) (*AgentReturn, error)
}
```

`AgentInput` carries the conversation (`Messages`, `NewMessages`), the
thread id, the live `ScenarioState`, the config and `PropagationHeaders`
(W3C `traceparent`): forward them to an HTTP agent so its spans join the
scenario trace. Return `TextReturn`, `MessageReturn`, `MessagesReturn` (tool
calls and results) or, for judges, `VerdictReturn`. `NewConnectedAgent`
runs an agent written against the LangWatch connected-agent contract.

The built-in agents are `NewUserSimulatorAgent` (with an optional `Persona`)
and `NewJudgeAgent` (custom `SystemPrompt`, criteria, trace discovery
settings). `ScenarioConfig.MinTurns` keeps the judge from ending the test
early; an explicit `Judge()` and the last turn always get a verdict.

## Results

```go
result.Success
result.Reasoning
result.MetCriteria, result.UnmetCriteria, result.InconclusiveCriteria
result.Criteria        // per criterion: requirement, status, reasoning
result.ReachedMaxTurns // ended at the turn cap
result.Messages, result.TotalTime, result.AgentTime
```

`Run` returns an error for an invalid config, an agent failure or a failed
`Assert`; the result is still returned and reported in those cases.

## State views

Inside a step or an agent, `ex.State()` / `input.ScenarioState` offers
`Messages()`, `LastMessage()`, `LastUserMessage()`, `LastAgentMessage()`,
`LastToolCall(name)`, `HasToolCall(name)`, `FirstUserMessage()`,
`Transcript()`, `ToolCalls(name...)` (merged from messages and tool spans,
with `First`, `Last`, `Inputs`, `Outputs`), `Turns()`, `Traces()`, `Spans()`,
`Contexts()`, `Fields()` / `Field(name)` and `Criteria()`.

## Providers

| Module | Client |
|--------|--------|
| `providers/openai` | `github.com/openai/openai-go/v3` |
| `providers/anthropic` | `github.com/anthropics/anthropic-sdk-go` |
| `providers/gemini` | `google.golang.org/genai` |
| `providers/bedrock` | `github.com/aws/aws-sdk-go-v2/service/bedrockruntime` |

Each exposes `NewProvider(client)` plus message converters for your own
adapters. Any type with `Inference(ctx, InferenceParams) (*InferenceResult, error)`
is a `scenario.LLM`.

## LangWatch

Set `LANGWATCH_API_KEY` (and `LANGWATCH_PROJECT_ID` for personal access
tokens) to stream each run to LangWatch; `LANGWATCH_ENDPOINT` selects a
self-hosted instance. Per run, `scenario.WithLangWatch(...)`,
`WithBatchRunID`, `WithRunID`, `WithHTTPClient` and the config's `SetID` /
`ThreadID` override everything without touching the environment.

Tracing is set up on the first run. To customize it, call
`scenario.SetupScenarioTracing(scenario.TracingOptions{...})` first (extra
processors, an exporter, `Filters: []langwatch.Filter{scenario.ScenarioOnly()}`).
An application that already set a global SDK `TracerProvider` keeps it: the
scenario span collector and exporter are attached to it. `FlushTracing` and
`ShutdownTracing` are available for process exit.

Group runs with `SetID`; all runs of one `go test ./...` invocation share a
batch (`SCENARIO_BATCH_RUN_ID` overrides it).

## Development

```bash
go vet ./... && go test -race ./...          # core
(cd providers/openai && go test -race ./...) # each provider
(cd examples && go vet ./...)                 # examples (need OPENAI_API_KEY to run)
go test -run TestGolden -update .             # regenerate testdata/events
```

## License

MIT
