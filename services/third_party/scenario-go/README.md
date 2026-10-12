# Scenario Go SDK

![scenario](https://github.com/langwatch/scenario/raw/refs/heads/main/assets/scenario-wide.webp)

Test AI agents with simulated users and an LLM judge, in realistic, scripted
multi-turn scenarios. The Go SDK follows the JavaScript SDK: same script DSL,
same judge, same events and traces in [LangWatch](https://langwatch.ai). The
few places where it deliberately differs are listed in
[Differences from the JavaScript SDK](#differences-from-the-javascript-sdk).

## Contents

- [Installation](#installation) and [quick start](#quick-start)
- [Providers](#providers), [scripts](#scripts), [agents](#agents), [the judge](#the-judge), [results](#results)
- [Tracing](#tracing), [granular events](#granular-events), [LangWatch](#langwatch)
- [Embedding in a server](#embedding-in-a-server)
- [Go tests with scenariotest](#go-tests-with-scenariotest)
- [Evaluators](#evaluators), [red teaming](#red-teaming), [Claude Code](#claude-code), [voice](#voice)
- [Examples](#examples), [differences from JS](#differences-from-the-javascript-sdk), [development](#development)

## Features

- **Provider agnostic**: any model behind the small `scenario.LLM` interface;
  adapters for OpenAI, Anthropic, Gemini and Bedrock in separate modules
- **Scripted or simulated conversations**: `User()`, `Agent()`, `Judge()`,
  `Proceed()`, `Succeed()`, `Fail()` and your own steps
- **Two-phase judge** with a verdict per criterion (passed, failed,
  inconclusive), reading both the transcript and the OpenTelemetry spans of
  your agent, local or fetched from LangWatch
- **LangWatch evaluators** on scenario runs, **red teaming** (Crescendo,
  GOAT), **Claude Code** as the agent under test
- **Voice**: OpenAI Realtime, Gemini Live, ElevenLabs, Pipecat, Twilio and
  composed STT → LLM → TTS agents, with recordings, barge-ins and audio effects
- **Multimodal messages**: text, images, files and audio
- **`go test` native**: runs are independent values, safe under `t.Parallel()`
  and inside long-running servers

## Installation

Go 1.25 or later.

```bash
go get github.com/langwatch/scenario/go
go get github.com/langwatch/scenario/go/providers/openai   # or anthropic, gemini, bedrock
go get github.com/langwatch/scenario/go/voice              # only for voice agents
```

The evaluators, red-team, Claude Code and `scenariotest` packages are part of
the core module (`github.com/langwatch/scenario/go/...`), so they need no
extra `go get`.

## Quick start

```go
package myagent_test

import (
	"context"
	"testing"

	scenario "github.com/langwatch/scenario/go"
	scenarioopenai "github.com/langwatch/scenario/go/providers/openai"
	"github.com/openai/openai-go/v3"
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

There is no config file. Set a process-wide default model once instead of on
every agent (the Go counterpart of `scenario.config.js`):

```go
scenario.Configure(scenario.WithDefaultModel(model))
```

`Configure` also takes `WithHeadless`, `WithGranularEvents`,
`WithFetchRemoteTraces`, `WithTraceWait`, `WithTraceQuietPeriod`,
`WithRemoteTraceFetcher`, `WithEvaluatorRunner` and `WithBatchRunOpener`. It
is safe for concurrent use; runs already started keep the settings they read.

## Providers

| Module | Client | Registry names |
|--------|--------|----------------|
| [`providers/openai`](providers/openai) | `github.com/openai/openai-go/v3` | `openai`, `azure`, `openrouter`, `ollama`, `groq`, `together_ai`, `hosted_vllm`, `litellm_proxy`, `mistral`, `deepseek`, `xai`, `fireworks_ai` |
| [`providers/anthropic`](providers/anthropic) | `github.com/anthropics/anthropic-sdk-go` | `anthropic` |
| [`providers/gemini`](providers/gemini) | `google.golang.org/genai` | `gemini`, `google`, `vertex_ai` |
| [`providers/bedrock`](providers/bedrock) | `github.com/aws/aws-sdk-go-v2/service/bedrockruntime` | `bedrock` |

Each exposes `NewProvider(client)` plus message converters for your own
adapters. Any type with `Inference(ctx, InferenceParams) (*InferenceResult, error)`
is a `scenario.LLM`.

`ModelConfig.Temperature` and `MaxTokens` are pointers: nil leaves the
provider default, which keeps reasoning models that reject a temperature
working.

### Model strings

Like the JS and Python SDKs, a model can be a `"provider/model"` string.
Register the providers you use once (nothing is registered by default, so
importing the SDK sets up no client), then name models by string; API keys
come from the usual environment variables (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `AWS_*`, …):

```go
func TestMain(m *testing.M) {
	scenarioopenai.Register()    // openai/, azure/, openrouter/, ollama/, …
	scenarioanthropic.Register() // anthropic/
	// or one name at a time: scenario.RegisterProvider("openai", scenarioopenai.Factory)
	scenario.Configure(scenario.WithDefaultModel(scenario.ModelConfig{Model: "openai/gpt-4.1-mini"}))
	os.Exit(m.Run())
}

judge := scenario.NewJudgeAgent(scenario.JudgeAgentConfig{
	ModelConfig: scenario.ModelConfig{Model: "anthropic/claude-sonnet-4-5"},
	Criteria:    []string{"The agent offers help"},
})
```

The string splits at its first slash, so `"openrouter/anthropic/claude-sonnet-4.5"`
asks OpenRouter for `anthropic/claude-sonnet-4.5`. `ModelConfig.APIKey`,
`BaseURL` and `Headers` override the environment for one model. An agent's
model naming its own provider does not inherit the default `LLM`; a bare
model name (`"gpt-4.1"`) keeps the default's provider. Your own agents can
get a ready LLM with `scenario.ModelConfig{Model: "groq/llama-3.3-70b-versatile"}.Resolve()`.
`scenario.RegisterProvider(name, factory)` adds your own providers.

### Streaming your agent

When granular events are on (`SCENARIO_SEND_GRANULAR_EVENTS=1` or
`WithGranularEvents(true)`), `AgentInput.Stream` shows your agent's message
live in LangWatch. Each provider module has a helper that runs a streaming
completion, forwards text deltas and tool calls to it, and returns the final
message; `Stream` is nil, and the helpers still work, when granular events
are off:

```go
agent := scenario.AgentFunc(func(ctx context.Context, in scenario.AgentInput) (*scenario.AgentReturn, error) {
	res, err := provider.Stream(ctx, scenario.InferenceParams{Model: "gpt-4.1-mini", Messages: in.Messages}, in.Stream)
	if err != nil {
		return nil, err
	}
	return scenario.MessageReturn(res.Message), nil
})
```

`openai.StreamChatCompletion`, `anthropic.StreamMessage`,
`gemini.StreamGenerateContent` and `bedrock.StreamConverse` do the same for
requests built with the providers' own SDK types. The built-in user
simulator and judge do not stream.

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

`ScriptStep` is an interface (`Run(ctx, *Executor) error`), so packages add
their own steps: the voice package has `voice.Interrupt`, `voice.AudioFile`,
`voice.Silence`, `voice.DTMF` and more; the red-team agent builds a whole
script with `MarathonScript`.

Inside a step, `ex.State()` reads the run: `Messages()`, `LastMessage()`,
`LastUserMessage()`, `LastAgentMessage()`, `LastToolCall(name)`,
`HasToolCall(name)`, `FirstUserMessage()`, `Transcript()`,
`ToolCalls(name...)` (merged from messages and tool spans, with `First`,
`Last`, `Inputs`, `Outputs`), `Turns()`, `Traces()`, `Spans()`,
`Contexts()`, `Fields()` / `Field(name)` and `Criteria()`. Agents get the
same state as `input.ScenarioState`.

## Agents

```go
type AgentAdapter interface {
	Role() AgentRole // AgentRoleAgent, AgentRoleUser or AgentRoleJudge
	Call(ctx context.Context, input AgentInput) (*AgentReturn, error)
}
```

`scenario.AgentFunc` adapts a function to the agent-under-test role.
`AgentInput` carries the conversation (`Messages`, `NewMessages`), the thread
id, the live `ScenarioState`, the config, `Stream` (see
[granular events](#granular-events)) and `PropagationHeaders` (W3C
`traceparent`): forward them to an HTTP agent so its spans join the scenario
trace. Return `TextReturn`, `MessageReturn`, `MessagesReturn` (tool calls and
results) or, for judges, `VerdictReturn`. `NewConnectedAgent` runs an agent
written against the LangWatch connected-agent contract.

The built-in agents are `NewUserSimulatorAgent` (with an optional `Persona`
or a replacement `SystemPrompt`) and `NewJudgeAgent`.

## The judge

```go
judge := scenario.NewJudgeAgent(scenario.JudgeAgentConfig{
	ModelConfig: model,
	Criteria: []string{
		"The agent asks for the booking reference",
		"The agent never promises a refund",
	},
})
```

- **Criteria**: each one gets its own verdict: passed, failed or
  inconclusive (the judge could not tell; it also counts as unmet). Inline
  criteria on a step, `Judge(WithCriteria(...))`, replace the configured ones
  for that checkpoint.
- **When it decides**: mid-conversation the judge first decides whether it
  has seen enough, then gives a verdict. `ScenarioConfig.MinTurns` keeps it
  from ending the test before that many turns; `MaxTurns` caps the run. An
  explicit `Judge()` step and the last turn always get a verdict.
- **Additional context**: `Judge(WithAdditionalContext(text))` shows the
  judge evidence it can't see in the conversation, such as files on disk or
  command output gathered by a step.
- **Prompt**: `SystemPrompt` replaces the built-in prompts; the phase rules
  are still appended.
- **Traces**: the judge reads the OpenTelemetry spans of your agent next to
  the transcript, from the run's `SpanCollector`
  (`DefaultSpanCollector()` unless set).
- **Large traces**: above `TokenThreshold` (estimated 8192 tokens) the judge
  gets a structure-only view of the trace plus `expand_trace` and
  `grep_trace` tools, and explores it in at most `MaxDiscoverySteps` (10)
  tool-calling steps.
- **Remote traces**: for an agent running in another process (its spans
  exported to LangWatch, not collected here), turn on
  `ScenarioConfig.FetchRemoteTraces` (or `Configure(WithFetchRemoteTraces(true))`).
  Before its verdict the judge waits up to `TraceWaitTimeout` (30s) for the
  traces of the turns to settle in LangWatch (unchanged for
  `TraceQuietPeriod`, 2s) and may ask for one extension
  (`TraceWaitExtension`). The remote agent must continue the trace from
  `AgentInput.PropagationHeaders`. A custom `RemoteTraceFetcher` or
  `NewRemoteTraceFetcher(RemoteTraceFetcherOptions{HTTPClient: ...})`
  replaces the default LangWatch one.
- **Audio**: `IncludeAudio` passes audio to the judge model (nil:
  auto-detected from the conversation and the model); `IncludeTimeline`
  adds context such as the voice timeline (nil: when the conversation has
  audio).

A custom judge is any `AgentAdapter` with `AgentRoleJudge` that returns
`nil` until `input.JudgmentRequest` is set, then `VerdictReturn(...)`; see
[examples/custom_judge_test.go](examples/custom_judge_test.go) and
[examples/custom_judge_with_traces_test.go](examples/custom_judge_with_traces_test.go).

## Results

```go
result.Success
result.Reasoning
result.MetCriteria, result.UnmetCriteria, result.InconclusiveCriteria
result.Criteria        // per criterion: requirement, status, reasoning
result.ReachedMaxTurns // ended at the turn cap without a verdict
result.Evaluations     // one per LangWatch evaluator
result.Messages, result.TotalTime, result.AgentTime
result.Extensions      // subsystem results, read through voice.ResultOf(result) etc.
```

`Run` returns an error for an invalid config, an agent failure or a failed
`Assert`; the result is still returned and reported in those cases. Agent
errors are wrapped, so `errors.As` finds the original (for example a
`*claudecode.CLIError`). `ScenarioConfig.Verbose` prints the transcript of
failing runs.

## Tracing

Tracing is set up on the first run: a global OpenTelemetry `TracerProvider`
with the scenario span collector (what the judge reads) and, when
`LANGWATCH_API_KEY` is set, the LangWatch exporter. Spans your agent starts
from the `ctx` it receives are children of the agent call span, so they join
the scenario trace:

```go
var tracer = otel.Tracer("my-agent")

func (a *myAgent) Call(ctx context.Context, in scenario.AgentInput) (*scenario.AgentReturn, error) {
	ctx, span := tracer.Start(ctx, "db.query")
	defer span.End()
	// ...
}
```

To customize it, call `SetupScenarioTracing` before the first run (later
calls are no-ops):

```go
err := scenario.SetupScenarioTracing(scenario.TracingOptions{
	Filters:        []langwatch.Filter{scenario.ScenarioOnly()}, // or scenario.WithCustomScopes("my-agent")
	SpanProcessors: []sdktrace.SpanProcessor{myProcessor},
	TraceExporter:  myExporter, // batched, next to LangWatch
	// DisableLangWatchExporter: true,
})
```

**Existing provider**: an application that already set a global SDK
`TracerProvider` (`otel.SetTracerProvider(sdktrace.NewTracerProvider(...))`)
keeps it; the span collector and the LangWatch exporter are attached to it
instead of installing a new one.

**Process exit**: `Run` flushes after each run. Call
`scenario.FlushTracing(ctx)` before exiting a process that started spans of
its own, and `scenario.ShutdownTracing(ctx)` once, when no run is in
progress (a provider the application owns is only flushed, never shut down).

## Granular events

By default every message is posted to LangWatch as a snapshot once it is
complete. With granular events the run posts message lifecycle events (text
start/content/end, tool call start/args/end), and an agent can show its
message while producing it through `AgentInput.Stream`:

```go
for stream.Next() {
	delta := stream.Current().Choices[0].Delta.Content
	text.WriteString(delta)
	in.Stream.TextDelta(delta) // ToolCallStart/ToolCallArgs/ToolCallEnd for tools
}
return scenario.TextReturn(text.String()), nil // stays authoritative
```

It is opt-in: per run with `scenario.WithGranularEventsForRun(true)`, for the
process with `Configure(scenario.WithGranularEvents(true))`, or with
`SCENARIO_SEND_GRANULAR_EVENTS=true`. When it is off `in.Stream` is nil and
its methods do nothing, so the same agent works both ways. See
[examples/streaming_agent_test.go](examples/streaming_agent_test.go).

## LangWatch

Set `LANGWATCH_API_KEY` (and `LANGWATCH_PROJECT_ID` for personal access
tokens) to stream each run to LangWatch; `LANGWATCH_ENDPOINT` selects a
self-hosted instance. Group runs with `SetID`; all runs of one
`go test ./...` invocation share a batch (`SCENARIO_BATCH_RUN_ID` overrides
it). On the first run the SDK opens the live batch in a LangWatch tab
(`SCENARIO_BROWSER=auto|never|always`; `SCENARIO_HEADLESS` or CI turns it
off).

Other environment variables: `SCENARIO_LOG_LEVEL` (or `scenario.SetLogger`),
`SCENARIO_DISABLE_SIMULATION_REPORT_INFO` (no console banners).

## Embedding in a server

Everything a run needs can be passed to that run, so a service can run many
scenarios at once for different projects:

```go
result, err := scenario.Run(ctx, cfg,
	scenario.WithLangWatch(scenario.LangWatchConfig{ // this run's project, not the environment
		Endpoint: tenant.Endpoint, APIKey: tenant.APIKey, ProjectID: tenant.ProjectID,
	}),
	scenario.WithHTTPClient(egressClient), // posts this run's events
	scenario.WithRunID(job.RunID),         // pre-assigned ids
	scenario.WithBatchRunID(job.BatchID),
	scenario.WithQuiet(),                  // no console banners
	scenario.WithEventListener(func(e scenario.Event) { stream.Send(e) }),
	scenario.WithValue(myKey, myValue), // per-run values for extensions
)
```

- `ScenarioConfig.LangWatch` sets the project per scenario; `WithLangWatch`
  overrides it per invocation; empty fields fall back to the environment.
- Results are values: `*ScenarioResult` holds the verdict, messages,
  evaluations and extension results (such as the voice recording). Nothing
  fails or exits on your behalf.
- `Configure(scenario.WithHeadless(true))` keeps the SDK from opening a
  browser; a custom `WithBatchRunOpener` replaces that behaviour.
- `NewRemoteTraceFetcher(RemoteTraceFetcherOptions{HTTPClient: ...})` and
  the voice adapters' `HTTPClient` options route the rest of the traffic
  through your client. Voice settings ride on the run
  (`voice.WithConfig(...)`), not on process state.

## Go tests with scenariotest

`scenariotest` ties a run to its test, like the JS vitest integration and the
Python pytest plugin: the chat log and verdict go to the test log, a failed
verdict fails the test, and `Main` prints a summary of every scenario the
binary ran.

```go
func TestMain(m *testing.M) { os.Exit(scenariotest.Main(m)) }

func TestRefund(t *testing.T) {
	t.Parallel()
	scenariotest.Run(t, scenario.ScenarioConfig{
		Name:        "refund request",
		Description: "The customer wants a refund for a late order.",
		Agents:      []scenario.AgentAdapter{myAgent, userSim, judge},
	})
}
```

## Evaluators

LangWatch evaluators run on the scenario next to the judge, with each input
mapped from the scenario state. **In Go the runner must be registered once**
(the core package does not import its subpackages):

```go
scenario.Configure(scenario.WithEvaluatorRunner(evaluators.NewRunner()))

result, err := scenario.Run(ctx, scenario.ScenarioConfig{
	// ...
	Fields: map[string]scenario.FieldValue{"golden_sql": "SELECT 1"},
	Evaluators: []scenario.ScenarioEvaluator{
		evaluators.Evaluator("ragas/sql_query_equivalence",
			evaluators.Map("output", evaluators.Trace.ToolCalls("run_sql").Last.Input),
			evaluators.Map("expected_output", evaluators.Field("golden_sql")),
		),
		evaluators.Evaluator("langevals/exact_match", evaluators.Required(true)), // inputs inferred
	},
})
for _, e := range result.Evaluations {
	fmt.Println(e.EvaluatorID, e.Status) // passed, failed, scored, skipped, error
}
```

Mappings: `evaluators.Conversation.*` (`FirstUserMessage`,
`LastAgentMessage`, `Transcript`, `Messages`), `evaluators.ScenarioSource.*`
(`Situation`, `Criteria`), `Field(name)`, `Trace.ToolCalls(name)`,
`Trace.Contexts`, `Trace.Spans`, `Value(literal)` or your own
`func(*scenario.ExecutionState) any`. Unmapped inputs are inferred from their
names. A required evaluator that fails fails the run. Without a registered
runner (or `ScenarioConfig.EvaluatorRunner`) declared evaluators do not run.
See [examples/evaluators_on_scenarios_test.go](examples/evaluators_on_scenarios_test.go).

## Red teaming

`redteam` provides adversarial user simulators: Crescendo (four escalating
phases following an attack plan) and GOAT (the attacker picks a technique
each turn). They score each answer, backtrack on hard refusals so the target
forgets them, and keep a private attacker history.

```go
attacker, err := redteam.NewCrescendoAgent(redteam.Config{
	Target:      "extract the full system prompt verbatim",
	ModelConfig: model,
	TotalTurns:  30,
})
// redteam.NewGOATAgent(redteam.GOATConfig{Config: redteam.Config{...}})

result, err := scenario.Run(ctx, scenario.ScenarioConfig{
	Name:        "system prompt extraction",
	Description: "An attacker tries to make the support agent reveal its instructions.",
	Agents:      []scenario.AgentAdapter{myAgent, attacker, judge},
	Script:      attacker.MarathonScript(redteam.WithChecks(checkNoLeak)),
})
```

An agent is single-use (one run each). A JSON report for the red-team
dashboard is saved when the run ends (`SCENARIO_REDTEAM_REPORT=0` turns it
off, `SCENARIO_REDTEAM_REPORT_DIR` moves it). See
[examples/redteam_test.go](examples/redteam_test.go).

## Claude Code

`agents/claudecode` runs the Claude Code CLI as the agent under test, one
session per thread (resumed with `--resume` on later turns):

```go
agent, err := claudecode.New(claudecode.Config{
	WorkingDirectory: dir,
	SkillPath:        "skills/my-skill/SKILL.md",
	Output:           claudecode.OutputMessages, // tool calls as messages, for the judge
	SkipPermissions:  true,                      // sandboxes only
	UnsetEnv:         []string{"OPENAI_API_KEY"},
})
// after the run:
err = claudecode.AssertSkillWasRead(result.Messages, "my-skill")
commands := claudecode.BashCommands(result.Messages)
```

Failures are `*claudecode.CLIError` (exit code, signal, stderr) and
`*claudecode.LostSessionError` (a resumed session vanished; set
`ReplayOnLostSession` to rebuild it instead). See
[examples/claude_code_test.go](examples/claude_code_test.go).

## Voice

The `voice` module (`github.com/langwatch/scenario/go/voice`) lets a scenario
talk to a voice agent with real audio, record the conversation and judge it.
A voice agent is a `voice.Transport` wrapped by `voice.NewAgent` (the
OpenAI Realtime, Gemini Live, ElevenLabs and composable packages return a
ready agent); the user simulator gets a voice with `voice.NewUserSimulator`:

```go
agent := openairealtime.New(openairealtime.Options{
	Instructions: "You are a restaurant booking assistant.",
})

res, err := scenario.Run(ctx, scenario.ScenarioConfig{
	Name:        "booking by phone",
	Description: "The caller books a table for two",
	Agents: []scenario.AgentAdapter{
		agent,
		voice.NewUserSimulator(scenario.NewUserSimulatorAgent(simCfg),
			voice.UserSimulatorOptions{Voice: "openai/nova"}),
		scenario.NewJudgeAgent(judgeCfg),
	},
	Script: []scenario.ScriptStep{
		scenario.Proceed(scenario.Turns(3)),
		voice.Interrupt(voice.WithContent("sorry, make that four")),
		scenario.Judge(),
	},
}, voice.WithConfig(voice.Config{STTModel: "openai/gpt-4o-transcribe"}))

rec := voice.ResultOf(res).Recording
rec.SaveSegments("out/booking", voice.SaveSegmentsOptions{})
```

| Package | Agent |
|---------|-------|
| `voice/adapters/openairealtime` | OpenAI Realtime as the agent, or (`Role: scenario.AgentRoleUser`) as the voice user simulator |
| `voice/adapters/geminilive` | Gemini Live native audio |
| `voice/adapters/elevenlabs` | a hosted ElevenLabs Conversational AI agent |
| `voice/adapters/composable` | your own STT → LLM → TTS pipeline (`NewElevenLabsAgent` for ElevenLabs STT/TTS around any LLM) |
| `voice/adapters/pipecat` | a Pipecat bot you run (`-t twilio` WebSocket transport) |
| `voice/adapters/twilio` | a real phone call over Twilio Media Streams, SDK-owned (`New`) or over a socket you accepted (`NewStream`) |

Script steps: `voice.User(opts, text...)`, `voice.AudioFile(path)`,
`voice.AudioBytes`, `voice.Silence(d)`, `voice.Sleep(d)`, `voice.DTMF(tones)`,
`voice.BackgroundNoise(source, volume)`, `voice.Interrupt(...)`,
`voice.AgentNonBlocking()`. Audio effects (`voice/effects`: noise, phone
line, packet loss, echo, speed, ...) degrade the simulator's speech;
`InterruptProbability` makes it barge in at random. The judge reads the
transcribed audio plus the voice timeline; `voice.ResultOf(res)` holds the
recording, timeline and latency metrics. `voice/voicetest` has in-memory
fakes for offline tests. Speech providers are named `"provider/model"`
(`openai/gpt-4o-transcribe`, `elevenlabs/scribe_v1`, `openai/nova`, ...).

Audio inside the framework is PCM16, 24 kHz, mono. WAV is read and written
natively; other formats (mp3, ogg, flac) need an `ffmpeg` on `PATH` or in
`SCENARIO_FFMPEG`. See [voice/examples](voice/examples) and the package
docs (`go doc github.com/langwatch/scenario/go/voice`).

## Examples

[examples](examples) ports the JavaScript examples: tool mocking, custom
judges, span-based and trace-based judging, remote agents (JSON, SSE,
streaming, stateful, traces), custom observability, evaluators, red teaming,
Claude Code, a streaming agent and more. [voice/examples](voice/examples)
holds the voice ones. They skip themselves without the keys they need:

```bash
cd examples && OPENAI_API_KEY=... go test -run TestWeatherAgent -v .
```

## Differences from the JavaScript SDK

The Go SDK matches the JavaScript SDK's events, prompts and verdicts. Where
it differs, it does so on purpose:

- **Evaluators need a registered runner**:
  `scenario.Configure(scenario.WithEvaluatorRunner(evaluators.NewRunner()))`
  (or `ScenarioConfig.EvaluatorRunner`), because the core package never
  imports its subpackages. Without it declared evaluators do not run.
- **No config file**: `scenario.Configure(...)` and environment variables
  replace `scenario.config.js`.
- **Errors are values**: `Run` returns `(*ScenarioResult, error)` and never
  fails a test on its own; `scenariotest.Run` does that part.
- **The judge reads the voice timeline by default** in conversations with
  audio (`IncludeTimeline` nil); the JS judge has the setting but does not
  send the timeline.
- **No bundled ffmpeg**: WAV is handled natively; other audio formats use
  `ffmpeg` from `PATH` or `SCENARIO_FFMPEG`.
- **Barge-in audio is not sent twice**: after an interrupting line is
  recorded it is removed from the agent's pending input, so the recovery turn
  does not replay it (the JS comment intends this; the JS code re-sends it).
- **Model-call spans**: the built-in judge, user simulator, red-team and
  composable voice agents record their model calls as LLM spans in the
  scenario tracer scope, so `ScenarioOnly()` keeps them; the judge leaves its
  own calls out of its trace digest on every turn.
- **Tunnels**: cloudflared and ngrok (`voice/tunnel/ngrok`, its own module);
  there is no localtunnel provider.
- **ElevenLabs** dials with the same client identifier as the JS SDK
  (`source=js_sdk`, see `voice/adapters/elevenlabs/protocol.go`), so
  ElevenLabs sees identical traffic from both.

## Development

```bash
go vet ./... && go test -race ./...          # core
(cd providers/openai && go test -race ./...) # each provider
(cd voice && go test -race ./...)            # voice
(cd examples && go vet ./...)                # examples (need OPENAI_API_KEY to run)
(cd voice/examples && go vet ./...)
go test -run TestGolden -update .            # regenerate testdata/events
```

## License

MIT
