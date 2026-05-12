package app

import (
	"context"
	"time"

	"go.uber.org/zap"
)

// App is the nlpgo application. It composes the engine, the gateway
// client, the child-process manager, and the secrets resolver. All
// fields are injected via Options so tests can swap any dependency.
type App struct {
	logger     *zap.Logger
	gateway    GatewayClient
	llm        LLMClient
	code       CodeRunner
	secrets    SecretsResolver
	childProxy ChildProxy
	childMgr   ChildManager
	executor   WorkflowExecutor
}

// WorkflowExecutor is the engine port: takes a parsed workflow + inputs
// and returns the final result. Defined here so the handler doesn't
// import the engine package directly (cleaner test surface).
type WorkflowExecutor interface {
	Execute(ctx context.Context, req WorkflowRequest) (*WorkflowResult, error)
	ExecuteStream(ctx context.Context, req WorkflowRequest, opts WorkflowStreamOptions) (<-chan WorkflowStreamEvent, error)
}

// WorkflowStreamOptions tunes the streaming endpoint per request.
type WorkflowStreamOptions struct {
	Heartbeat time.Duration
}

// WorkflowStreamEvent is one frame on the streaming endpoint. Mirrors
// the Python StudioServerEvent discriminated union one-for-one so the
// SSE handler can serialize verbatim.
type WorkflowStreamEvent struct {
	Type    string         `json:"type"` // is_alive_response | execution_state_change | done | error
	TraceID string         `json:"trace_id,omitempty"`
	Payload map[string]any `json:"payload,omitempty"`
}

// WorkflowRequest is the shape passed to the engine. Mirrors the engine
// package's ExecuteRequest so the handler doesn't need to know engine
// internals.
type WorkflowRequest struct {
	WorkflowJSON []byte
	Inputs       map[string]any
	Origin       string
	TraceID      string
	ProjectID    string
	ThreadID     string
	// NodeID, when non-empty, identifies the single node the Studio
	// "Run with manual input" flow targets. In that mode `Inputs` are
	// fed directly into the named node (bypassing edge-based input
	// resolution) so users can exercise a node in isolation without
	// wiring a parent Entry → target edge first. Empty means
	// execute_flow / execute_evaluation, where Inputs go to the Entry
	// node and propagate via edges.
	NodeID string
	// APIKey is `workflow.api_key` from the inbound payload — peeked
	// out of WorkflowJSON at decode time so the request handler can
	// stash it on the request context before creating its top-level
	// OTel span. Without this, the handler-level span runs before the
	// engine_adapter parses the workflow, so the TenantRouter has no
	// api_key in context yet and drops the span. Engine-internal spans
	// also use it for sibling-trace correlation.
	APIKey string
	// Type is the discriminator from the inbound StudioClientEvent
	// envelope ("execute_flow" / "execute_component" / "execute_evaluation").
	// Determines which workflow-level state-change family the engine emits:
	// execute_flow → execution_state_change, execute_evaluation →
	// evaluation_state_change, execute_component → no workflow-level
	// state events (per-node only). Empty falls back to execute_flow
	// behavior — the historical default for flat (non-discriminated)
	// payloads from tests + curl.
	Type string
	// DoNotTrace suppresses the engine's outer "nlpgo.studio.execute_*"
	// span, matching Python's optional_langwatch_trace(do_not_trace=...)
	// behavior at langwatch_nlp/studio/execute/execute_flow.py:53.
	// Two source paths: (1) envelope-level event.do_not_trace=true sent
	// by sub-workflow callers (Python CustomNode.forward / Go
	// agentblock.WorkflowRunner) so the inner trace doesn't double-count
	// against the parent's span, (2) workflow.enable_tracing=false (set
	// by customers who explicitly opt out of tracing for a particular
	// workflow). The handler ORs the two before stamping this field so
	// the engine consults a single boolean.
	DoNotTrace bool
	// RunID identifies the evaluation run on `execute_evaluation` events.
	// Stamped into evaluation_state_change payloads so Studio's reducer
	// can match streamed updates to the run it dispatched (the reducer
	// keys evaluations on workflow.state.evaluation.run_id, set by
	// Studio's startEvaluation hook). Unused for non-evaluation event
	// types.
	RunID string
	// WorkflowVersionID is the persisted workflow version that owns this
	// evaluation run. Used for the batch/log_results POST so the experiment
	// dashboard can pin results to the version that produced them.
	WorkflowVersionID string
	// EvaluateOn selects the dataset slice to iterate ("full"/"test"/
	// "train"/"specific"). Defaults to "full" when empty (the Studio
	// Evaluate button's default).
	EvaluateOn string
	// DatasetEntry is the row index for evaluate_on="specific". Ignored
	// otherwise.
	DatasetEntry *int
}

// WorkflowResult is the engine's response, ready for JSON serialization.
type WorkflowResult struct {
	TraceID    string         `json:"trace_id"`
	Status     string         `json:"status"`
	Result     map[string]any `json:"result,omitempty"`
	Nodes      map[string]any `json:"nodes,omitempty"`
	TotalCost  float64        `json:"total_cost,omitempty"`
	DurationMS int64          `json:"duration_ms,omitempty"`
	Error      *WorkflowError `json:"error,omitempty"`
}

// WorkflowError is the structured error attached when the engine fails.
type WorkflowError struct {
	NodeID    string `json:"node_id,omitempty"`
	Type      string `json:"type"`
	Message   string `json:"message"`
	Traceback string `json:"traceback,omitempty"`
}

// Option configures an App.
type Option func(*App)

// New constructs an App with the given options. Missing dependencies
// are tolerated at construction time; handlers check for nil and
// return a clear error so a partially-wired App still boots and
// serves /healthz.
func New(opts ...Option) *App {
	a := &App{}
	for _, o := range opts {
		o(a)
	}
	return a
}

// WithLogger injects the logger.
func WithLogger(l *zap.Logger) Option { return func(a *App) { a.logger = l } }

// WithGateway injects the AI gateway client.
func WithGateway(g GatewayClient) Option { return func(a *App) { a.gateway = g } }

// WithLLM injects the LLM block executor (wraps GatewayClient + translator).
func WithLLM(l LLMClient) Option { return func(a *App) { a.llm = l } }

// WithCodeRunner injects the code-block sandbox runner.
func WithCodeRunner(c CodeRunner) Option { return func(a *App) { a.code = c } }

// WithSecrets injects the secrets resolver used by HTTP blocks.
func WithSecrets(s SecretsResolver) Option { return func(a *App) { a.secrets = s } }

// WithChildProxy injects the reverse proxy that forwards unmatched
// requests to the uvicorn child.
func WithChildProxy(p ChildProxy) Option { return func(a *App) { a.childProxy = p } }

// WithChildManager injects the uvicorn lifecycle manager.
func WithChildManager(m ChildManager) Option { return func(a *App) { a.childMgr = m } }

// WithWorkflowExecutor injects the workflow engine.
func WithWorkflowExecutor(e WorkflowExecutor) Option { return func(a *App) { a.executor = e } }

// Executor returns the configured workflow executor (nil during scaffold).
func (a *App) Executor() WorkflowExecutor { return a.executor }

// Logger returns the configured logger or a noop if unset.
func (a *App) Logger() *zap.Logger {
	if a.logger == nil {
		return zap.NewNop()
	}
	return a.logger
}

// Gateway returns the configured gateway client (may be nil during
// scaffold).
func (a *App) Gateway() GatewayClient { return a.gateway }

// LLM returns the configured LLM executor (may be nil during scaffold).
func (a *App) LLM() LLMClient { return a.llm }

// Code returns the configured code-block runner (may be nil during scaffold).
func (a *App) Code() CodeRunner { return a.code }

// Secrets returns the configured secrets resolver (may be nil).
func (a *App) Secrets() SecretsResolver { return a.secrets }

// ChildProxy returns the reverse proxy to the uvicorn child.
func (a *App) ChildProxy() ChildProxy { return a.childProxy }

// ChildManager returns the uvicorn lifecycle manager.
func (a *App) ChildManager() ChildManager { return a.childMgr }
