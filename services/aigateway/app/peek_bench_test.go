package app

import (
	"testing"
)

func BenchmarkPeekModel(b *testing.B) {
	body := []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"hello"}],"stream":true}`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = PeekModel(body)
	}
}

func BenchmarkPeekStream(b *testing.B) {
	body := []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"hello"}],"stream":true}`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = PeekStream(body)
	}
}
