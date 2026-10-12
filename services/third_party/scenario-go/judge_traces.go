package scenario

import (
	"context"
	"time"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/langwatch/scenario/go/internal/jsjson"
	"github.com/langwatch/scenario/go/internal/spandigest"
)

// TraceSettleTarget is a batch of remote traces of a thread to wait for.
type TraceSettleTarget struct {
	ThreadID string
	// TraceIDs are the trace ids the conversation's messages carry.
	TraceIDs  []string
	Collector *SpanCollector
	LangWatch LangWatchConfig
	// Timeout bounds the wait.
	Timeout time.Duration
	// QuietPeriod is how long a trace must stay unchanged to be complete.
	QuietPeriod time.Duration
}

// RemoteTraceFetcher fetches the spans the agent under test produced
// remotely from the LangWatch trace API and adds them to the collector, so
// the judge verifies internal behavior against real spans. The core judge
// drives it; an implementation lives in a separate package and is
// registered with Configure(WithRemoteTraceFetcher(...)) or set on the
// judge config.
type RemoteTraceFetcher interface {
	// SettleWait waits until every trace settled or the timeout passed, and
	// reports whether all settled. Unsettled traces get a synthetic error
	// span. It never fails.
	SettleWait(ctx context.Context, target TraceSettleTarget) (allSettled bool)
	// ExtendSettle waits once more for still unsettled traces.
	ExtendSettle(ctx context.Context, target TraceSettleTarget)
	// NoneSettled reports whether not one of the traces ever settled.
	NoneSettled(threadID string, traceIDs []string) bool
	// RecordMissingTraceIDs records that fetching is on but no message
	// carries a trace id, as a synthetic error span.
	RecordMissingTraceIDs(threadID string, collector *SpanCollector)
	// ClearThread drops the fetch state of a thread.
	ClearThread(threadID string)
}

// traceSettings are the resolved remote trace options of one judge call.
type traceSettings struct {
	fetch       bool
	fetcher     RemoteTraceFetcher
	timeout     time.Duration
	extension   time.Duration
	quietPeriod time.Duration
}

func resolveTraceSettings(cfg ScenarioConfig, own RemoteTraceFetcher) traceSettings {
	s := currentSettings()
	ts := traceSettings{fetch: s.FetchRemoteTraces, fetcher: own}
	if cfg.FetchRemoteTraces != nil {
		ts.fetch = *cfg.FetchRemoteTraces
	}
	if ts.fetch {
		ts.fetcher = resolveTraceFetcher(own, s)
	}
	ts.timeout = firstPositive("TraceWaitTimeout", DefaultTraceWaitTimeout, cfg.TraceWaitTimeout, s.TraceWaitTimeout)
	ts.extension = firstPositive("TraceWaitExtension", ts.timeout, cfg.TraceWaitExtension, s.TraceWaitExtension)
	ts.quietPeriod = DefaultTraceQuietPeriod
	for _, d := range []*time.Duration{cfg.TraceQuietPeriod, s.TraceQuietPeriod} {
		if d == nil {
			continue
		}
		if *d >= 0 {
			ts.quietPeriod = *d
			break
		}
		logger().Warn("TraceQuietPeriod must be a non-negative duration; ignoring it", "value", d.String())
	}
	return ts
}

// resolveTraceFetcher picks the judge's own fetcher, the registered one, or
// the SDK's default.
func resolveTraceFetcher(own RemoteTraceFetcher, s *Settings) RemoteTraceFetcher {
	if own != nil {
		return own
	}
	if s.RemoteTraceFetcher != nil {
		return s.RemoteTraceFetcher
	}
	return DefaultRemoteTraceFetcher()
}

// SettleRemoteTraces waits, under the run's trace wait budget and quiet
// period, for the remote traces of the run's messages to arrive in the span
// collector, as the judge does before its verdict. Evaluator runners call it
// when a mapping read the trace and found nothing. It never fails, and
// returns at once when no message carries a trace id or no API key is set.
func (ex *Executor) SettleRemoteTraces(ctx context.Context) {
	ids := messageTraceIDs(ex.state.Messages())
	lw := resolveLangWatch(ex.cfg.LangWatch)
	if len(ids) == 0 || lw.APIKey == "" {
		return
	}
	s := currentSettings()
	ts := resolveTraceSettings(ex.cfg, nil)
	resolveTraceFetcher(nil, s).SettleWait(ctx, TraceSettleTarget{
		ThreadID: ex.cfg.ThreadID, TraceIDs: ids, Collector: DefaultSpanCollector(),
		LangWatch: lw, Timeout: ts.timeout, QuietPeriod: ts.quietPeriod,
	})
}

// firstPositive returns the first positive duration, warning about
// negative ones (zero means unset), else fallback.
func firstPositive(field string, fallback time.Duration, values ...time.Duration) time.Duration {
	for _, v := range values {
		if v > 0 {
			return v
		}
		if v < 0 {
			logger().Warn(field+" must be a positive duration; ignoring it", "value", v.String())
		}
	}
	return fallback
}

// traceDigest renders the spans for the judge: in full, or structure-only
// with the discovery hint when the full digest exceeds the token threshold.
func traceDigest(spans []sdktrace.ReadOnlySpan, threshold int) (digest string, large bool) {
	full := spandigest.Format(spans)
	if len(spans) == 0 || spandigest.EstimateTokens(full) <= threshold {
		return full, false
	}
	return spandigest.FormatStructureOnly(spans) + spandigest.LargeTraceHint, true
}

// discoveryTools are expand_trace and grep_trace over spans.
func discoveryTools(spans []sdktrace.ReadOnlySpan) []JudgeTool {
	return []JudgeTool{
		{
			Definition: ToolDefinition{
				Name:        "expand_trace",
				Description: expandTraceDescription,
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"span_ids": map[string]any{
							"type":        "array",
							"items":       map[string]any{"type": "string"},
							"description": "Span IDs (or 8-char prefixes) to expand",
						},
					},
					"required":             []any{"span_ids"},
					"additionalProperties": false,
				},
			},
			Execute: func(_ context.Context, args string) (string, error) {
				var ids []string
				if v, err := jsjson.Parse(args); err == nil {
					if obj, ok := v.(jsjson.Object); ok {
						if list, ok := obj.Get("span_ids"); ok {
							if arr, ok := list.([]any); ok {
								for _, e := range arr {
									if s, ok := e.(string); ok {
										ids = append(ids, s)
									}
								}
							}
						}
					}
				}
				return spandigest.ExpandTrace(spans, ids), nil
			},
		},
		{
			Definition: ToolDefinition{
				Name:        "grep_trace",
				Description: grepTraceDescription,
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"pattern": map[string]any{"type": "string", "description": "Search pattern (case-insensitive)"},
					},
					"required":             []any{"pattern"},
					"additionalProperties": false,
				},
			},
			Execute: func(_ context.Context, args string) (string, error) {
				pattern := ""
				if v, err := jsjson.Parse(args); err == nil {
					if obj, ok := v.(jsjson.Object); ok {
						if p, ok := obj.Get("pattern"); ok {
							pattern, _ = p.(string)
						}
					}
				}
				return spandigest.GrepTrace(spans, pattern), nil
			},
		},
	}
}
