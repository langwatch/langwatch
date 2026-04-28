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
