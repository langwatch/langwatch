package nlpgo

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/proxypass"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/uvicornchild"
)

// configureNLPGoOTel installs nlpgo's OTel provider in multi-tenant
// mode: every span is routed to a per-tenant exporter keyed by the
// inbound `workflow.api_key`, so spans from project A and project B
// can't end up in one another's traces even when the same Lambda
// container handles both.
//
// Endpoint resolution mirrors the legacy Python service: read
// `LANGWATCH_ENDPOINT` (the universal LangWatch URL env var), append
// the OTLP traces path. Falls back to the generic `OTEL_OTLP_ENDPOINT`
// only when LANGWATCH_ENDPOINT is unset, for environments that wire
// OTel via the standard OTel env vars.
func configureNLPGoOTel(ctx context.Context, cfg Config, nodeID string) (*otelsetup.Provider, error) {
	endpoint := strings.TrimSpace(os.Getenv("LANGWATCH_ENDPOINT"))
	if endpoint != "" {
		endpoint = strings.TrimRight(endpoint, "/") + "/api/otel/v1/traces"
	} else {
		endpoint = cfg.OTel.OTLPEndpoint
		if endpoint != "" && !strings.HasSuffix(endpoint, "/v1/traces") {
			endpoint = strings.TrimRight(endpoint, "/") + "/v1/traces"
		}
	}
	return otelsetup.New(ctx, otelsetup.Options{
		NodeID:       nodeID,
		OTLPEndpoint: endpoint,
		SampleRatio:  cfg.OTel.SampleRatio,
		MultiTenant:  true,
	})
}

// Deps holds nlpgo's infrastructure adapters.
type Deps struct {
	Logger     *zap.Logger
	NodeID     string
	OTel       *otelsetup.Provider
	Health     *health.Registry
	Child      *uvicornchild.Manager
	ChildProxy http.Handler
}

// NewDeps wires every adapter from the validated Config.
func NewDeps(ctx context.Context, cfg Config) (context.Context, *Deps, error) {
	if err := cfg.Log.Validate(); err != nil {
		return ctx, nil, err
	}
	logger := clog.New(ctx, cfg.Log)
	ctx = clog.Set(ctx, logger)
	nodeID := resolveNodeID(ctx, logger)

	otelProvider, err := configureNLPGoOTel(ctx, cfg, nodeID)
	if err != nil {
		return ctx, nil, fmt.Errorf("otel init: %w", err)
	}

	probes := health.New(contexts.MustGetServiceInfo(ctx).Environment)

	child := uvicornchild.New(uvicornchild.Options{
		Command:   cfg.Child.Command,
		Args:      splitArgs(cfg.Child.ArgsRaw),
		HealthURL: cfg.Child.HealthURL,
		Disabled:  cfg.Child.Bypass,
		Logger:    logger,
	})

	probes.RegisterReadiness("uvicorn_child", func() (bool, string) {
		hctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := child.Healthy(hctx); err != nil {
			return false, err.Error()
		}
		return true, ""
	})
	probes.MarkStarted()

	var proxy http.Handler
	if cfg.Child.UpstreamURL != "" {
		p, err := proxypass.New(proxypass.Options{
			UpstreamURL: cfg.Child.UpstreamURL,
			Logger:      logger,
		})
		if err != nil {
			return ctx, nil, fmt.Errorf("proxypass init: %w", err)
		}
		proxy = p
	}

	return ctx, &Deps{
		Logger:     logger,
		NodeID:     nodeID,
		OTel:       otelProvider,
		Health:     probes,
		Child:      child,
		ChildProxy: proxy,
	}, nil
}

// splitArgs tokenizes a space-separated args string from env into a
// []string for exec.Command. Quoted args aren't supported (operator
// passes simple flag lists in practice; if quoting is needed, add a
// shell-style splitter behind a feature flag).
func splitArgs(s string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == ' ' || s[i] == '\t' {
			if i > start {
				out = append(out, s[start:i])
			}
			start = i + 1
		}
	}
	return out
}

func resolveNodeID(ctx context.Context, logger *zap.Logger) string {
	hostname, err := os.Hostname()
	if err != nil {
		id := ulid.Make().String()
		logger.Warn("hostname_unavailable", zap.Error(err), zap.String("fallback_node_id", id))
		_ = ctx
		return id
	}
	return hostname
}
