package telemetrysim

import (
	"bytes"
	"testing"
	"time"

	colltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

func backfillSpans(t *testing.T, fill Backfill) []*tracepb.Span {
	t.Helper()
	fill.Encoding = EncodingProtobuf
	payload, err := BuildBackfill(fill)
	if err != nil {
		t.Fatal(err)
	}
	var req colltracepb.ExportTraceServiceRequest
	if err := proto.Unmarshal(payload.Body, &req); err != nil {
		t.Fatal(err)
	}
	var spans []*tracepb.Span
	for _, rs := range req.GetResourceSpans() {
		spans = append(spans, rs.GetScopeSpans()[0].GetSpans()...)
	}
	return spans
}

func TestBackfillStaysInsideItsWindowAndIgnoresChunking(t *testing.T) {
	start := time.Date(2026, 7, 1, 9, 0, 0, 0, time.UTC)
	wide, _ := PresetByName("wide-trace")
	rag, _ := PresetByName("rag-trace")
	parts := []Part{{Preset: wide, Index: 0, Count: 150}, {Preset: rag, Index: 1, Count: 4}, {Preset: rag, Index: 2, Count: 2}}
	whole := backfillSpans(t, Backfill{Seed: 3, Start: start, Window: time.Hour, Parts: parts})
	if len(whole) != 156 {
		t.Fatalf("got %d spans, want 156", len(whole))
	}
	for _, s := range whole {
		if s.GetStartTimeUnixNano() < nanos(start) || s.GetEndTimeUnixNano() >= nanos(start.Add(time.Hour)) {
			t.Fatalf("span %s at %d leaves the hour", s.GetName(), s.GetStartTimeUnixNano())
		}
	}
	split := append(backfillSpans(t, Backfill{Seed: 3, Start: start, Window: time.Hour, Parts: parts[:1]}),
		backfillSpans(t, Backfill{Seed: 3, Start: start, Window: time.Hour, Parts: parts[1:]})...)
	for i := range whole {
		if !proto.Equal(whole[i], split[i]) {
			t.Fatalf("span %d differs when chunked differently", i)
		}
	}
	again, _ := BuildBackfill(Backfill{Seed: 3, Start: start, Window: time.Hour, Parts: parts, Encoding: EncodingJSON})
	first, _ := BuildBackfill(Backfill{Seed: 3, Start: start, Window: time.Hour, Parts: parts, Encoding: EncodingJSON})
	if !bytes.Equal(first.Body, again.Body) {
		t.Fatal("the same backfill gave different bytes")
	}
	logs, _ := PresetByName("logs")
	if _, err := BuildBackfill(Backfill{Parts: []Part{{Preset: rag, Count: 1}, {Preset: logs, Count: 1}}}); err == nil {
		t.Fatal("a chunk mixing signals was accepted")
	}
}
