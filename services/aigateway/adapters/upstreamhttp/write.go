// Package upstreamhttp owns the one implementation of the gateway's
// upstream-error forwarding contract: a provider's terminal response reaches
// the client under the provider's own status, with the provider's own body,
// on every HTTP lane that fronts the dispatcher.
//
// It lives in its own package because there is more than one such lane. The
// gateway's own router was the first; nlpgo's /go/proxy/v1/* surface is the
// second, and it shipped without the contract — every upstream failure there
// became a 502 "gateway_unavailable" with the provider's status, message and
// body discarded, which reads in the logs as "our gateway went down" for what
// was really a provider answering 429 or 5xx. Both lanes now call
// WriteUpstreamError, so the contract cannot drift between them again.
//
// @see specs/ai-gateway/error-transparency.feature
package upstreamhttp

import (
	"net/http"

	"github.com/bytedance/sonic"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// WriteUpstreamError forwards a provider's terminal response to the client.
// The provider's native error body is written byte-for-byte when present, so
// the client sees the exact upstream envelope under the upstream's real
// status code (not a masked 502) and can tell terminal from retryable. When
// the native body is unavailable, the minimal envelope still preserves the
// error's identity: the provider's own error type/code (insufficient_quota,
// overloaded_error, ...) when the adapter parsed them, and a generic
// provider_error only when nothing better is known. The originating provider
// rides a response header either way, since the verbatim body cannot be
// tampered with to carry it.
func WriteUpstreamError(w http.ResponseWriter, ue *domain.UpstreamError) {
	status := ue.StatusCode
	if status <= 0 {
		status = http.StatusBadGateway
	}
	// Forward the upstream's retry-signaling headers (Retry-After,
	// x-should-retry) so the client can honor the provider's backoff and
	// terminal-vs-retryable hint, not just the status code. Passthrough
	// lanes forward the upstream's headers wholesale, including its exact
	// Content-Type (e.g. Google's "application/json; charset=UTF-8"), so
	// only default the Content-Type when the upstream did not provide one.
	for k, v := range ue.Headers {
		w.Header().Set(k, v)
	}
	// A provider must not be able to make its body look LangWatch-authored.
	// herr.WriteHTTP sets this marker only for our handled envelopes.
	w.Header().Del(herr.HandledErrorHeader)
	if ue.Provider != "" {
		w.Header().Set("X-LangWatch-Provider", ue.Provider)
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(status)
	if len(ue.Body) > 0 {
		_, _ = w.Write(ue.Body)
		return
	}
	errType := ue.ErrorType
	if errType == "" {
		errType = ue.ErrorCode
	}
	if errType == "" {
		errType = "provider_error"
	}
	errCode := ue.ErrorCode
	if errCode == "" {
		errCode = errType
	}
	meta := map[string]any{"status": status}
	if ue.Provider != "" {
		meta["provider"] = ue.Provider
	}
	body, _ := sonic.Marshal(map[string]any{
		"error": map[string]any{
			"type":    errType,
			"code":    errCode,
			"message": ue.Message,
			"meta":    meta,
		},
	})
	_, _ = w.Write(body)
}
