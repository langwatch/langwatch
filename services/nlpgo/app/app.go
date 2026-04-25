package app

import (
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
