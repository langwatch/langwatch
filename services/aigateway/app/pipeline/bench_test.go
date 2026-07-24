package pipeline

import (
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

var (
	benchBodyDisable = []byte(`{"model":"claude-3-5-sonnet-20241022","system":[{"type":"text","text":"You are a helpful assistant.","cache_control":{"type":"ephemeral"}},{"type":"text","text":"Extra context.","cache_control":{"type":"ephemeral"}}],"messages":[{"role":"user","content":[{"type":"text","text":"Hello","cache_control":{"type":"ephemeral"}},{"type":"text","text":"World","cache_control":{"type":"ephemeral"}}]}],"max_tokens":1024}`)
	benchBodyForce   = []byte(`{"model":"claude-3-5-sonnet-20241022","system":[{"type":"text","text":"You are a helpful assistant."},{"type":"text","text":"Extra context."}],"messages":[{"role":"user","content":[{"type":"text","text":"Hello"},{"type":"text","text":"World"}]}],"max_tokens":1024}`)
	benchBodyRespect = []byte(`{"model":"claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"Hello"}],"max_tokens":1024}`)
)

func BenchmarkApplyCacheOverride_RuleHitModeDisable(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		applyCacheControl(benchBodyDisable, domain.CacheActionDisable, domain.RequestTypeMessages)
	}
}

func BenchmarkApplyCacheOverride_RuleHitModeForce(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		applyCacheControl(benchBodyForce, domain.CacheActionForce, domain.RequestTypeMessages)
	}
}

func BenchmarkApplyCacheOverride_NoOp(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		applyCacheControl(benchBodyRespect, domain.CacheActionRespect, domain.RequestTypeMessages)
	}
}
