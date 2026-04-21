package controlplane

import (
	"net/http"
	"testing"
)

// BenchmarkSign measures the canonical HMAC signing path used on every
// internal gateway→control-plane call (resolve-key, config, budget/debit,
// guardrail/check).
func BenchmarkSign(b *testing.B) {
	s, err := NewSigner("shared-test-secret-32byteslong!!", "gw-bench")
	if err != nil {
		b.Fatal(err)
	}
	body := []byte(`{"key_presented":"lw_vk_live_01HZX0123456789ABCDEFGHIJ","gateway_node_id":"gw-bench"}`)

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		req, _ := http.NewRequest("POST", "http://cp/api/internal/gateway/resolve-key", nil)
		s.Sign(req, body)
	}
}

// BenchmarkSign_EmptyBody stresses the GET path (FetchConfig /
// WaitForChanges) where body is nil.
func BenchmarkSign_EmptyBody(b *testing.B) {
	s, err := NewSigner("shared-test-secret-32byteslong!!", "gw-bench")
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		req, _ := http.NewRequest("GET", "http://cp/api/internal/gateway/config/vk_01", nil)
		s.Sign(req, nil)
	}
}
