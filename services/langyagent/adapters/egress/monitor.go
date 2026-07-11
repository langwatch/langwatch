// This file adds the ADR-044 part 5 egress MONITORING behaviour behind the
// Guard seam PR1 shipped: it observes and FLAGS suspicious worker/manager
// outbound calls, and NEVER blocks. Enforcement (dropping/killing on a flag) is
// PR4 — this PR gives PR4 ground truth (real flagged traffic) to tune against.
//
// Two observation surfaces:
//   - MonitoringGuard implements Guard: a per-worker span + attribution on
//     spawn/teardown. PrepareWorker still returns nil (observe-only — the guard
//     never fails a spawn closed here; that is a PR4 policy decision).
//   - InstrumentedRoundTripper wraps an http.RoundTripper: a `langy.egress` span
//     + metrics + the ScoreEgress flag scorer on every outbound call it sees.
//     NOTE: the opencode WORKER subprocess makes its own outbound calls and does
//     NOT route through this Go transport — the pod NetworkPolicy governs that.
//     So this transport observes MANAGER-originated calls; the scorer +
//     NetworkPolicy together are the ground truth PR4 enforces against.
package egress

import (
	"context"
	"net"
	"net/http"
	"strconv"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

const instrumentationName = "langwatch-langyagent-egress"

// FlagReason names why an egress call is suspicious (ADR-033 threat model +
// the NetworkPolicy denied ranges). Empty = not flagged.
type FlagReason string

const (
	FlagNone          FlagReason = ""
	FlagMetadata      FlagReason = "cloud_metadata_ip"
	FlagPrivateRange  FlagReason = "private_range_ip"
	FlagUnexpectedHost FlagReason = "unexpected_host"
	FlagPlaintext     FlagReason = "plaintext_external"
	FlagLargeUpload   FlagReason = "large_upload_exfil_shape"
	FlagHighFanout    FlagReason = "high_distinct_host_fanout"
)

// Config bounds the scorer. AllowedHosts is the set a worker legitimately
// reaches (control plane, gateway, git / gh / package-registry hosts). The
// private/metadata ranges are the ones the NetworkPolicy denies (ADR-033); they
// are built in so the scorer and the policy never drift.
type Config struct {
	AllowedHosts     []string
	LargeUploadBytes int64
	MaxDistinctHosts int
}

// DefaultConfig returns sensible bounds. AllowedHosts is normally overridden
// from env/manager config with the deployment's real control-plane / gateway
// hostnames.
func DefaultConfig() Config {
	return Config{
		AllowedHosts:     nil,
		LargeUploadBytes: 25 << 20, // 25 MiB — an outbound payload larger than this is exfil-shaped
		MaxDistinctHosts: 20,       // more than this many distinct hosts in one turn is high fan-out
	}
}

// EgressCall is one outbound call, reduced to what the scorer needs.
type EgressCall struct {
	Host                  string
	Port                  int
	TLS                   bool
	BytesUp               int64
	DistinctHostsThisTurn int
}

// ScoreResult is the scorer's verdict. Flagged never implies blocked (PR3).
type ScoreResult struct {
	Flagged bool
	Reason  FlagReason
}

// The private + link-local/metadata ranges the NetworkPolicy denies (ADR-033).
var (
	privateCIDRs  = mustCIDRs("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fd00::/8")
	metadataCIDRs = mustCIDRs("169.254.0.0/16", "fe80::/10")
)

func mustCIDRs(cidrs ...string) []*net.IPNet {
	out := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			panic("egress: bad built-in CIDR " + c)
		}
		out = append(out, n)
	}
	return out
}

func inAny(ip net.IP, nets []*net.IPNet) bool {
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func hostAllowed(host string, allowed []string) bool {
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	if h == "localhost" {
		return true
	}
	for _, a := range allowed {
		a = strings.ToLower(strings.TrimSuffix(a, "."))
		if h == a || strings.HasSuffix(h, "."+a) {
			return true
		}
	}
	return false
}

// ScoreEgress flags suspicious egress shapes. Reasons are ordered by severity —
// the first matching (most severe) reason wins. It is pure and side-effect free
// so PR4 can reuse it as ground truth, and it NEVER decides to block.
func ScoreEgress(cfg Config, call EgressCall) ScoreResult {
	host := strings.ToLower(strings.TrimSuffix(call.Host, "."))
	allowed := hostAllowed(host, cfg.AllowedHosts)

	// IP-literal destinations: check the denied ranges first (most severe).
	if ip := net.ParseIP(host); ip != nil {
		if inAny(ip, metadataCIDRs) {
			return ScoreResult{true, FlagMetadata}
		}
		if inAny(ip, privateCIDRs) {
			return ScoreResult{true, FlagPrivateRange}
		}
	}

	if !allowed {
		return ScoreResult{true, FlagUnexpectedHost}
	}
	if !call.TLS {
		// An allowed host reached WITHOUT TLS is still suspicious (plaintext
		// external). localhost is exempted by hostAllowed above only for the
		// allow check; plaintext to a real external allowed host is flagged.
		if host != "localhost" {
			return ScoreResult{true, FlagPlaintext}
		}
	}
	if cfg.LargeUploadBytes > 0 && call.BytesUp > cfg.LargeUploadBytes {
		return ScoreResult{true, FlagLargeUpload}
	}
	if cfg.MaxDistinctHosts > 0 && call.DistinctHostsThisTurn > cfg.MaxDistinctHosts {
		return ScoreResult{true, FlagHighFanout}
	}
	return ScoreResult{false, FlagNone}
}

// MonitoringGuard is the observe-only Guard. It emits a per-worker span and
// records attribution; PrepareWorker returns nil (never fails the spawn — that
// is a PR4 enforcement decision).
type MonitoringGuard struct {
	cfg    Config
	tracer trace.Tracer
}

// NewMonitoringGuard builds the observe-only guard.
func NewMonitoringGuard(cfg Config) *MonitoringGuard {
	return &MonitoringGuard{cfg: cfg, tracer: otel.Tracer(instrumentationName)}
}

// PrepareWorker records the worker starting. Observe-only: it runs no proxy
// (returns a zero WorkerEgress) and never fails the spawn closed.
func (g *MonitoringGuard) PrepareWorker(ctx context.Context, w WorkerContext) (WorkerEgress, error) {
	_, span := g.tracer.Start(ctx, "langy.egress.worker.prepare",
		trace.WithAttributes(
			attribute.String("langy.conversation.id", w.ConversationID),
			attribute.Int64("langy.worker.uid", int64(w.UID)),
		),
	)
	span.End()
	return WorkerEgress{}, nil
}

// ReleaseWorker records the worker being torn down.
func (g *MonitoringGuard) ReleaseWorker(ctx context.Context, conversationID string) {
	_, span := g.tracer.Start(ctx, "langy.egress.worker.release",
		trace.WithAttributes(attribute.String("langy.conversation.id", conversationID)),
	)
	span.End()
}

var _ Guard = (*MonitoringGuard)(nil)

// InstrumentedRoundTripper wraps an http.RoundTripper to emit a `langy.egress`
// span + metrics + the flag scorer on every call it sees. It NEVER blocks: the
// base RoundTrip always runs, flagged or not.
type InstrumentedRoundTripper struct {
	base     http.RoundTripper
	cfg      Config
	tracer   trace.Tracer
	requests metric.Int64Counter
	bytes    metric.Int64Counter
}

// NewInstrumentedRoundTripper wraps base (defaulting to http.DefaultTransport).
func NewInstrumentedRoundTripper(base http.RoundTripper, cfg Config) *InstrumentedRoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	meter := otel.Meter(instrumentationName)
	requests, _ := meter.Int64Counter("langy.egress.requests",
		metric.WithDescription("Count of observed worker/manager egress calls, tagged by flagged."))
	bytesc, _ := meter.Int64Counter("langy.egress.bytes",
		metric.WithDescription("Bytes sent on observed egress calls."))
	return &InstrumentedRoundTripper{
		base:     base,
		cfg:      cfg,
		tracer:   otel.Tracer(instrumentationName),
		requests: requests,
		bytes:    bytesc,
	}
}

func (rt *InstrumentedRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	host := req.URL.Hostname()
	tls := req.URL.Scheme == "https"
	port := 0
	if p := req.URL.Port(); p != "" {
		port, _ = strconv.Atoi(p)
	} else if tls {
		port = 443
	} else {
		port = 80
	}
	bytesUp := req.ContentLength
	if bytesUp < 0 {
		bytesUp = 0
	}

	score := ScoreEgress(rt.cfg, EgressCall{
		Host: host, Port: port, TLS: tls, BytesUp: bytesUp,
	})

	ctx, span := rt.tracer.Start(req.Context(), "langy.egress",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("server.address", host),
			attribute.Int("server.port", port),
			attribute.Int64("langy.egress.bytes_up", bytesUp),
			attribute.Bool("langy.egress.plaintext", !tls),
			attribute.Bool("langy.egress.flagged", score.Flagged),
			attribute.String("langy.egress.flag_reason", string(score.Reason)),
		),
	)
	defer span.End()

	rt.requests.Add(ctx, 1, metric.WithAttributes(attribute.Bool("flagged", score.Flagged)))
	rt.bytes.Add(ctx, bytesUp, metric.WithAttributes(attribute.String("host", host)))

	// NEVER block — always perform the call, flagged or not (PR3 observes; PR4
	// enforces).
	resp, err := rt.base.RoundTrip(req.WithContext(ctx))
	if resp != nil {
		span.SetAttributes(attribute.Int("http.response.status_code", resp.StatusCode))
		if resp.ContentLength >= 0 {
			span.SetAttributes(attribute.Int64("langy.egress.bytes_down", resp.ContentLength))
		}
	}
	return resp, err
}

var _ http.RoundTripper = (*InstrumentedRoundTripper)(nil)
