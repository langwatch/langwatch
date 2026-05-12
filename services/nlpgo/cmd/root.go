// Package cmd exposes the nlpgo service entrypoint for the mono-binary.
package cmd

import (
	"context"
	"net/http"
	"os"
	"strings"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/dispatcheradapter"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/agentblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/evaluatorblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)


// Root is the service entrypoint called by cmd/service.
func Root(ctx context.Context, _ []string) error {
	cfg, err := nlpgo.LoadConfig(ctx)
	if err != nil {
		return err
	}

	info := contexts.MustGetServiceInfo(ctx)
	info.Environment = cfg.Environment
	ctx = contexts.SetServiceInfo(ctx, *info)

	ctx, deps, err := nlpgo.NewDeps(ctx, cfg)
	if err != nil {
		return err
	}

	httpExec := httpblock.New(httpblock.Options{
		SSRF: httpblock.SSRFOptions{
			AllowedHosts: splitCSV(cfg.Engine.AllowedProxyHosts),
		},
	})
	codeExec, err := codeblock.New(codeblock.Options{
		Python: cfg.Engine.SandboxPython,
	})
	if err != nil {
		return err
	}

	// In-process AI Gateway dispatcher. The library pivot: nlpgo no
	// longer reaches the gateway over HTTP. Bifrost lives in the same
	// Go process and dispatches directly to providers using the
	// per-request credentials llmexecutor builds from the workflow's
	// litellm_params. No HMAC, no fourth server, no public hop.
	disp, err := dispatcher.New(ctx, dispatcher.Options{Logger: deps.Logger})
	if err != nil {
		return err
	}
	defer disp.Close()
	llm := llmexecutor.New(dispatcheradapter.New(disp))
	deps.Logger.Info("nlpgo_llm_wired", zap.String("transport", "in_process_dispatcher"))

	// Playground proxy uses the SAME dispatcher (no second Bifrost
	// process). It bridges the OpenAI-shape /go/proxy/v1/* surface
	// (used by the prompt playground + model.factory.ts) into the
	// in-process gateway. Header-based auth: x-litellm-* → Credential.
	playground := httpapi.NewPlaygroundProxyFromShim(playgroundDispatcherShim{disp: disp})

	// Evaluator + agent-workflow blocks call the LangWatch app's own
	// HTTP API. Both share the same LangWatchBaseURL.
	// Per-block timeouts default to 12min (Lambda max 15min minus 3min margin).
	evalExec := evaluatorblock.New(evaluatorblock.Options{})
	agentWfRunner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{})

	eng := engine.New(engine.Options{
		HTTP:             httpExec,
		Code:             codeExec,
		LLM:              llm,
		Evaluator:        evalExec,
		AgentWorkflow:    agentWfRunner,
		LangWatchBaseURL: resolveLangWatchBaseURL(cfg.Engine.LangWatchBaseURL, os.Getenv),
	})
	executor := engineAdapter{eng: eng}

	application := app.New(
		app.WithLogger(deps.Logger),
		app.WithChildProxy(deps.ChildProxy),
		app.WithChildManager(deps.Child),
		app.WithWorkflowExecutor(executor),
	)

	return nlpgo.Serve(ctx, application, deps, cfg, playground)
}

// resolveLangWatchBaseURL returns the base URL the evaluator and
// agent-workflow blocks use to call back into the LangWatch app. The
// explicit `NLPGO_ENGINE_LANGWATCH_BASE_URL` setting wins so dev /
// docker-compose can point evaluator callbacks at
// host.docker.internal:5560 without touching the universal endpoint;
// otherwise fall back to `LANGWATCH_ENDPOINT` — the same env var
// configureNLPGoOTel reads in deps.go and the env terraform pins on
// every Lambda. Pre-fix the evaluator path required the explicit var
// only and prod set just LANGWATCH_ENDPOINT, so every evaluator
// dispatch errored with "LangWatchBaseURL is required to call the
// evaluator API" (rchaves callout 2026-04-29).
//
// `getenv` is injected so tests don't need to mutate process env.
func resolveLangWatchBaseURL(explicit string, getenv func(string) string) string {
	if explicit != "" {
		return explicit
	}
	return strings.TrimRight(getenv("LANGWATCH_ENDPOINT"), "/")
}

// splitCSV splits "a,b,c" into ["a","b","c"], trimming whitespace and
// dropping empty entries.
func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == ',' {
			tok := s[start:i]
			for len(tok) > 0 && (tok[0] == ' ' || tok[0] == '\t') {
				tok = tok[1:]
			}
			for len(tok) > 0 && (tok[len(tok)-1] == ' ' || tok[len(tok)-1] == '\t') {
				tok = tok[:len(tok)-1]
			}
			if tok != "" {
				out = append(out, tok)
			}
			start = i + 1
		}
	}
	return out
}

// playgroundDispatcherShim adapts *dispatcher.Dispatcher (which works in
// terms of dispatcher.Request/Response) to httpapi.DispatcherShim (which
// works in terms of the playground-handler-internal struct shapes). The
// shim is mechanical: a field-by-field copy. We keep it in cmd/ so the
// httpapi package doesn't take a dependency on the dispatcher package.
type playgroundDispatcherShim struct {
	disp *dispatcher.Dispatcher
}

func (s playgroundDispatcherShim) Dispatch(ctx context.Context, req httpapi.DispatchRequest) (*httpapi.DispatchResponse, error) {
	resp, err := s.disp.Dispatch(ctx, dispatcher.Request{
		Type:       req.Type,
		Model:      req.Model,
		Body:       req.Body,
		Credential: req.Credential,
	})
	if err != nil {
		return nil, err
	}
	hdr := http.Header{}
	for k, v := range resp.Headers {
		hdr.Set(k, v)
	}
	return &httpapi.DispatchResponse{
		StatusCode: resp.StatusCode,
		Body:       resp.Body,
		Headers:    hdr,
	}, nil
}

func (s playgroundDispatcherShim) DispatchStream(ctx context.Context, req httpapi.DispatchRequest) (httpapi.DispatchStream, error) {
	iter, err := s.disp.DispatchStream(ctx, dispatcher.Request{
		Type:       req.Type,
		Model:      req.Model,
		Body:       req.Body,
		Credential: req.Credential,
	})
	if err != nil {
		return nil, err
	}
	return iter, nil
}

// Passthrough plumbs an /v1beta/*-style raw-forward request through the
// dispatcher's typed Passthrough API. The httpapi package keeps its
// PassthroughDispatchRequest free of the dispatcher.PassthroughRequest
// shape so it doesn't take a transitive aigateway import; this shim
// does the field-by-field copy.
func (s playgroundDispatcherShim) Passthrough(ctx context.Context, req httpapi.PassthroughDispatchRequest) (*httpapi.DispatchResponse, error) {
	resp, err := s.disp.Passthrough(ctx, dispatcher.PassthroughRequest{
		Request: dispatcher.Request{
			Type:       req.Type,
			Model:      req.Model,
			Body:       req.Body,
			Credential: req.Credential,
		},
		HTTP: domain.PassthroughRequest{
			Method:   req.HTTPMethod,
			Path:     req.HTTPPath,
			RawQuery: req.HTTPRawQuery,
			Headers:  req.HTTPHeaders,
			Stream:   req.Stream,
		},
	})
	if err != nil {
		return nil, err
	}
	hdr := http.Header{}
	for k, v := range resp.Headers {
		hdr.Set(k, v)
	}
	return &httpapi.DispatchResponse{
		StatusCode: resp.StatusCode,
		Body:       resp.Body,
		Headers:    hdr,
	}, nil
}

func (s playgroundDispatcherShim) PassthroughStream(ctx context.Context, req httpapi.PassthroughDispatchRequest) (httpapi.DispatchStream, error) {
	iter, err := s.disp.PassthroughStream(ctx, dispatcher.PassthroughRequest{
		Request: dispatcher.Request{
			Type:       req.Type,
			Model:      req.Model,
			Body:       req.Body,
			Credential: req.Credential,
		},
		HTTP: domain.PassthroughRequest{
			Method:   req.HTTPMethod,
			Path:     req.HTTPPath,
			RawQuery: req.HTTPRawQuery,
			Headers:  req.HTTPHeaders,
			Stream:   req.Stream,
		},
	})
	if err != nil {
		return nil, err
	}
	return iter, nil
}
