package engine

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// statusFailingLLM fails every call with an error exposing an upstream HTTP
// status, mirroring the llmexecutor.GatewayHTTPError duck type.
type statusFailingLLM struct{ err error }

func (f *statusFailingLLM) Execute(context.Context, app.LLMRequest) (*app.LLMResponse, error) {
	return nil, f.err
}
func (f *statusFailingLLM) ExecuteStream(context.Context, app.LLMRequest) (app.StreamIterator, error) {
	return nil, f.err
}

type statusErr struct {
	msg    string
	status int
}

func (e *statusErr) Error() string       { return e.msg }
func (e *statusErr) HTTPStatusCode() int { return e.status }

func signatureWorkflow() *dsl.Workflow {
	model := "openai/gpt-5-mini"
	return &dsl.Workflow{
		WorkflowID: "wf_faults",
		APIKey:     "k",
		DefaultLLM: &dsl.LLMConfig{Model: &model},
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry},
			{ID: "sig", Type: dsl.ComponentSignature, Data: dsl.Component{
				Inputs:  []dsl.Field{{Identifier: "q", Type: "str"}},
				Outputs: []dsl.Field{{Identifier: "answer", Type: "str"}},
			}},
		},
		Edges: []dsl.Edge{
			{Source: "entry", SourceHandle: "outputs.q", Target: "sig", TargetHandle: "inputs.q"},
		},
	}
}

func executeWithObservedLogs(t *testing.T, llmErr error) (*ExecuteResult, *observer.ObservedLogs) {
	t.Helper()
	core, logs := observer.New(zapcore.DebugLevel)
	ctx := clog.Set(context.Background(), zap.New(core))
	eng := New(Options{LLM: &statusFailingLLM{err: llmErr}})
	res, err := eng.Execute(ctx, ExecuteRequest{
		Workflow: signatureWorkflow(),
		Inputs:   map[string]any{"q": "hi"},
		TraceID:  "trace_faults",
	})
	require.NoError(t, err)
	return res, logs
}

func singleNodeFailureLog(t *testing.T, logs *observer.ObservedLogs) observer.LoggedEntry {
	t.Helper()
	entries := logs.FilterMessage("workflow_node_failed").All()
	require.Len(t, entries, 1)
	return entries[0]
}

// @scenario "A failed node is logged with its node and error identity"
func TestFailedNodeIsLoggedWithIdentity(t *testing.T) {
	res, logs := executeWithObservedLogs(t, &statusErr{msg: "boom upstream", status: 503})
	require.Equal(t, "error", res.Status)

	entry := singleNodeFailureLog(t, logs)
	fields := entry.ContextMap()
	assert.Equal(t, "sig", fields["node_id"])
	assert.Equal(t, string(dsl.ComponentSignature), fields["node_type"])
	assert.Equal(t, "llm_error", fields["error_type"])
	assert.Contains(t, fields["message"], "boom upstream")
}

// @scenario "An LLM call rejected by the provider carries the upstream status"
func TestLLMRejectionCarriesUpstreamStatusAndFault(t *testing.T) {
	res, logs := executeWithObservedLogs(t, &statusErr{msg: "credit balance too low", status: 402})
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Equal(t, 402, res.Error.Status, "upstream status must thread into the NodeError")

	entry := singleNodeFailureLog(t, logs)
	assert.Equal(t, zapcore.InfoLevel, entry.Level, "a 4xx rejection is on the customer")
	fields := entry.ContextMap()
	assert.Equal(t, "customer", fields["fault"])
	assert.Equal(t, int64(402), fields["upstream_status"])

	// And a 5xx is on the provider, at warn.
	_, logs5 := executeWithObservedLogs(t, &statusErr{msg: "upstream exploded", status: 502})
	entry5 := singleNodeFailureLog(t, logs5)
	assert.Equal(t, zapcore.WarnLevel, entry5.Level)
	assert.Equal(t, "provider", entry5.ContextMap()["fault"])
}

// @scenario "An engine bug is logged as a platform fault"
func TestEngineBugClassifiesAsPlatformFault(t *testing.T) {
	assert.Equal(t, faultPlatform, classifyNodeFault(&NodeError{Type: "engine_error", Message: "nil deref"}))
	assert.Equal(t, faultPlatform, classifyNodeFault(&NodeError{Type: "llm_executor_unavailable"}))
	assert.Equal(t, zapcore.ErrorLevel, faultPlatform.level())

	// Customer-shaped inputs stay off the pager.
	assert.Equal(t, faultCustomer, classifyNodeFault(&NodeError{Type: "invalid_dataset"}))
	assert.Equal(t, faultCustomer, classifyNodeFault(&NodeError{Type: "code_runner_error"}))
	// LLM-dependent failures without a status default to provider.
	assert.Equal(t, faultProvider, classifyNodeFault(&NodeError{Type: "evaluator_error"}))
}
