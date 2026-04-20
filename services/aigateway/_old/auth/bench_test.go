package auth

import (
	"bytes"
	"net/http"
	"testing"
)

// BenchmarkSignRequest measures the canonical HMAC signing path used
// on every internal gateway→control-plane call (resolve-key, config,
// changes, budget/debit, budget/check, guardrail/check). Every ms of
// per-signature cost multiplies by RPS across the fleet.
func BenchmarkSignRequest(b *testing.B) {
	r := NewHTTPResolver(HTTPResolverOptions{
		InternalSecret: "shared-test-secret-32byteslong!!",
		JWTSecret:      "jwt-secret-32-bytes-exactly!!!!!",
		GatewayNodeID:  "gw-bench",
	}).(*httpResolver)
	body := []byte(`{"key_presented":"lw_vk_live_01HZX0123456789ABCDEFGHIJ","gateway_node_id":"gw-bench"}`)
	req, _ := http.NewRequest("POST", "http://cp/api/internal/gateway/resolve-key", bytes.NewReader(body))

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		req.Header.Del("X-LangWatch-Gateway-Signature")
		req.Header.Del("X-LangWatch-Gateway-Timestamp")
		r.signRequestAt(req, body, 1734567890)
	}
}

// BenchmarkSignRequest_EmptyBody stresses the GET path (FetchConfig /
// WaitForChanges) where bodyForHash is nil. Should be a hair faster
// than the POST path because sha256 of an empty byte slice is a
// fixed constant internally.
func BenchmarkSignRequest_EmptyBody(b *testing.B) {
	r := NewHTTPResolver(HTTPResolverOptions{
		InternalSecret: "shared-test-secret-32byteslong!!",
		JWTSecret:      "jwt-secret-32-bytes-exactly!!!!!",
		GatewayNodeID:  "gw-bench",
	}).(*httpResolver)
	req, _ := http.NewRequest("GET", "http://cp/api/internal/gateway/config/vk_01", nil)

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		req.Header.Del("X-LangWatch-Gateway-Signature")
		req.Header.Del("X-LangWatch-Gateway-Timestamp")
		r.signRequestAt(req, nil, 1734567890)
	}
}

// BenchmarkKeyHash is the hot-path cache lookup hash. Fires on every
// inbound request BEFORE we can serve from L1. p50 for the whole
// auth path should stay well under this hash's own cost.
func BenchmarkKeyHash(b *testing.B) {
	raw := "lw_vk_live_01HZX0123456789ABCDEFGHIJ"
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = keyHash(raw)
	}
}
