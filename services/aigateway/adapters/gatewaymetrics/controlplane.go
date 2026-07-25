package gatewaymetrics

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// controlPlaneEndpoints maps the gateway's internal control-plane paths
// onto short, stable label values. Matching is by prefix because some
// paths carry an identifier (/config/<vk_id>), which must never reach a
// label. The set is closed by design: an unrecognized path folds onto the
// placeholder rather than becoming a label of its own, so a future
// endpoint cannot quietly widen the series count before anyone names it
// here.
var controlPlaneEndpoints = []struct{ prefix, name string }{
	{"/api/internal/gateway/resolve-key", "resolve-key"},
	{"/api/internal/gateway/guardrail/check", "guardrail-check"},
	{"/api/internal/gateway/config", "config"},
	{"/api/internal/gateway/changes", longPollEndpoint},
	{"/api/internal/gateway/codex/refresh", "codex-refresh"},
}

// longPollEndpoint is excluded from the round-trip histogram. The change
// feed is a long poll that blocks until an event or its own timeout, so
// timing it would swamp the buckets with a signal that says nothing about
// control-plane health.
const longPollEndpoint = "changes"

// RoundTripper times every gateway to control-plane call. Wrap the
// client's existing transport with it: it only measures and delegates.
type RoundTripper struct {
	inner    http.RoundTripper
	recorder *Recorder
}

// WrapTransport returns inner wrapped in round-trip metrics. Returns inner
// unchanged when there is nothing to record into.
func WrapTransport(inner http.RoundTripper, recorder *Recorder) http.RoundTripper {
	if recorder == nil {
		return inner
	}
	if inner == nil {
		inner = http.DefaultTransport
	}
	return &RoundTripper{inner: inner, recorder: recorder}
}

func (t *RoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	endpoint := classifyEndpoint(req.URL.Path)

	start := time.Now()
	resp, err := t.inner.RoundTrip(req)
	elapsed := time.Since(start).Seconds()

	if endpoint == longPollEndpoint {
		return resp, err
	}
	if err != nil {
		// No response ever arrived (DNS, dial, TLS, context cancellation).
		// `error` is a status value the alerts can match on directly.
		t.recorder.RecordControlPlaneCall(endpoint, "error", elapsed)
		return resp, err
	}
	t.recorder.RecordControlPlaneCall(endpoint, strconv.Itoa(resp.StatusCode), elapsed)
	return resp, nil
}

func classifyEndpoint(path string) string {
	for _, e := range controlPlaneEndpoints {
		if strings.HasPrefix(path, e.prefix) {
			return e.name
		}
	}
	return unknownLabel
}
