package engine

import (
	"context"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// fault attributes a node failure to who it is on, so operators can alert on
// error increases and tell customer-caused failures apart from platform
// problems. Customer faults are still logged (at info) because a spike in
// them can be a false flag for a platform problem.
type fault string

const (
	// faultCustomer: their workflow, dataset, code, endpoint, or provider
	// account (out of credits, invalid key).
	faultCustomer fault = "customer"
	// faultProvider: the upstream LLM provider or evaluator backend failed
	// or timed out. A spike here can also mean a misconfiguration on our
	// side (e.g. a too-low gateway timeout), so it warrants a look.
	faultProvider fault = "provider"
	// faultPlatform: our bug (engine error, executor not wired).
	faultPlatform fault = "platform"
)

// level maps fault attribution to log severity: customer→info,
// provider→warn, platform→error.
func (f fault) level() zapcore.Level {
	switch f {
	case faultCustomer:
		return zapcore.InfoLevel
	case faultProvider:
		return zapcore.WarnLevel
	default:
		return zapcore.ErrorLevel
	}
}

// classifyNodeFault attributes a node failure. An upstream HTTP status wins
// when present (4xx = the upstream rejected this caller, 5xx = the upstream
// failed); otherwise the NodeError type decides.
func classifyNodeFault(ne *NodeError) fault {
	if ne.Status >= 400 && ne.Status < 500 {
		return faultCustomer
	}
	if ne.Status >= 500 {
		return faultProvider
	}
	switch ne.Type {
	case "invalid_dataset", "invalid_workflow", "unsupported_node_kind",
		"code_runner_error", "code_block_timeout", "ssrf_blocked",
		"http_error", "upstream_http_error", "context_canceled":
		return faultCustomer
	case "llm_error", "evaluator_error", "agent_workflow_error", "custom_workflow_error":
		// LLM-dependent blocks without a status failed on the way to or at
		// the provider (transport error, timeout, malformed response).
		return faultProvider
	default:
		// engine_error, llm_executor_unavailable, anything unrecognized.
		return faultPlatform
	}
}

// logNodeFailure is the single log line every failed node passes through —
// the stable message CloudWatch metric filters key on. The ctx logger
// already carries project_id, trace_id and origin (workflow, evaluation,
// playground, scenario) from the request boundary, so failures are
// attributable per customer and per surface.
func logNodeFailure(ctx context.Context, node *dsl.Node, ne *NodeError) {
	f := classifyNodeFault(ne)
	fields := []zap.Field{
		zap.String("fault", string(f)),
		zap.String("node_id", ne.NodeID),
		zap.String("node_type", string(node.Type)),
		zap.String("error_type", ne.Type),
		zap.String("message", ne.Message),
	}
	if ne.Status > 0 {
		fields = append(fields, zap.Int("upstream_status", ne.Status))
	}
	clog.Get(ctx).Log(f.level(), "workflow_node_failed", fields...)
}
