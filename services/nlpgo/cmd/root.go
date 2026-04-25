// Package cmd exposes the nlpgo service entrypoint for the mono-binary.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/nlpgo"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/gatewayclient"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
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

	// Gateway-backed LLM executor — only wired when both BaseURL and
	// InternalSecret are configured. Without a gateway nlpgo can still
	// serve /go/studio/execute_sync for non-LLM workflows; LLM nodes
	// then surface llm_executor_unavailable so customers get a clear
	// signal rather than a hung request.
	var llm app.LLMClient
	if cfg.Gateway.BaseURL != "" && cfg.Gateway.InternalSecret != "" {
		gw, err := gatewayclient.New(gatewayclient.Options{
			BaseURL:        cfg.Gateway.BaseURL,
			InternalSecret: cfg.Gateway.InternalSecret,
		})
		if err != nil {
			return err
		}
		llm = llmexecutor.New(gw)
		deps.Logger.Info("nlpgo_llm_wired", zap.String("gateway_base_url", cfg.Gateway.BaseURL))
	} else {
		deps.Logger.Warn("nlpgo_llm_not_wired",
			zap.String("reason", "LW_GATEWAY_BASE_URL or LW_GATEWAY_INTERNAL_SECRET unset"))
	}

	eng := engine.New(engine.Options{
		HTTP: httpExec,
		Code: codeExec,
		LLM:  llm,
	})
	executor := engineAdapter{eng: eng}

	application := app.New(
		app.WithLogger(deps.Logger),
		app.WithChildProxy(deps.ChildProxy),
		app.WithChildManager(deps.Child),
		app.WithWorkflowExecutor(executor),
	)

	return nlpgo.Serve(ctx, application, deps, cfg)
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
