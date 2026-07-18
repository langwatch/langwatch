package ingestionbench

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"testing"
)

var testMarkers = map[string]string{"langwatch.benchmark.stage": "test"}

// testSpanArgs is the shared baseline the TypeScript helper `span(overrides)`
// provided; each test copies it and adjusts the fields it cares about.
func testSpanArgs() BuildSpanArgs {
	return BuildSpanArgs{
		TraceID:      strings.Repeat("a", 32),
		SpanID:       strings.Repeat("b", 16),
		Name:         "test-span",
		StartMs:      1_700_000_000_000,
		DurationMs:   10,
		PayloadBytes: 0,
		Markers:      testMarkers,
		Rng:          CreateRng(1),
	}
}

func TestCreateRng(t *testing.T) {
	t.Run("given the same seed", func(t *testing.T) {
		t.Run("produces the same sequence so a failing run can be replayed", func(t *testing.T) {
			a := CreateRng(42)
			b := CreateRng(42)

			for i := 0; i < 3; i++ {
				if got, want := a(), b(); got != want {
					t.Errorf("draw %d: got %v, want %v", i, got, want)
				}
			}
		})

		t.Run("stays inside the unit interval", func(t *testing.T) {
			rng := CreateRng(1234)
			for i := 0; i < 1000; i++ {
				v := rng()
				if v < 0 || v >= 1 {
					t.Fatalf("draw %d out of range: %v", i, v)
				}
			}
		})
	})

	t.Run("given different seeds", func(t *testing.T) {
		t.Run("produces different sequences", func(t *testing.T) {
			if CreateRng(1)() == CreateRng(2)() {
				t.Error("seeds 1 and 2 produced the same first draw")
			}
		})
	})
}

func TestHexID(t *testing.T) {
	t.Run("produces two hex characters per byte", func(t *testing.T) {
		cases := []struct{ bytes, want int }{{16, 32}, {8, 16}}
		for _, c := range cases {
			if got := len(HexID(c.bytes, CreateRng(1))); got != c.want {
				t.Errorf("HexID(%d) length = %d, want %d", c.bytes, got, c.want)
			}
		}
	})

	t.Run("produces only lowercase hex", func(t *testing.T) {
		got := HexID(16, CreateRng(7))
		if !regexp.MustCompile(`^[0-9a-f]+$`).MatchString(got) {
			t.Errorf("HexID produced %q, want lowercase hex only", got)
		}
	})
}

func TestFillerOfBytes(t *testing.T) {
	t.Run("produces exactly the requested byte length", func(t *testing.T) {
		for _, n := range []int{1, 100, 4096, 100_000} {
			if got := len(FillerOfBytes(n, CreateRng(3))); got != n {
				t.Errorf("FillerOfBytes(%d) length = %d, want %d", n, got, n)
			}
		}
	})

	t.Run("returns empty for non-positive sizes", func(t *testing.T) {
		for _, n := range []int{0, -5} {
			if got := FillerOfBytes(n, CreateRng(1)); got != "" {
				t.Errorf("FillerOfBytes(%d) = %q, want empty", n, got)
			}
		}
	})

	t.Run("uses ASCII only, so byte length equals string length", func(t *testing.T) {
		out := FillerOfBytes(500, CreateRng(9))
		if len(out) != len([]rune(out)) {
			t.Errorf("filler is not ASCII: %d bytes, %d runes", len(out), len([]rune(out)))
		}
	})
}

func TestMsToUnixNano(t *testing.T) {
	t.Run("converts milliseconds to nanoseconds as a string", func(t *testing.T) {
		if got, want := MsToUnixNano(1_700_000_000_000), "1700000000000000000"; got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})

	t.Run("does not lose precision on large timestamps", func(t *testing.T) {
		// Float arithmetic would lose digits here; the implementation uses int64.
		if got, want := MsToUnixNano(1_899_999_999_999), "1899999999999000000"; got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	})
}

func TestBuildSpan(t *testing.T) {
	t.Run("given no payload padding", func(t *testing.T) {
		t.Run("carries only the marker attributes", func(t *testing.T) {
			result := BuildSpan(testSpanArgs())

			if len(result.Attributes) != 1 || result.Attributes[0].Key != "langwatch.benchmark.stage" {
				t.Errorf("attributes = %+v, want only the stage marker", result.Attributes)
			}
		})

		t.Run("sets end time to start plus duration", func(t *testing.T) {
			args := testSpanArgs()
			args.StartMs = 1000
			args.DurationMs = 250

			if got, want := BuildSpan(args).EndTimeUnixNano, MsToUnixNano(1250); got != want {
				t.Errorf("got %q, want %q", got, want)
			}
		})
	})

	t.Run("given a payload larger than the per-attribute cap", func(t *testing.T) {
		t.Run("splits filler across attributes so none trips truncation", func(t *testing.T) {
			args := testSpanArgs()
			args.PayloadBytes = 400 * 1024

			for _, attr := range BuildSpan(args).Attributes {
				value := ""
				if attr.Value.StringValue != nil {
					value = *attr.Value.StringValue
				}
				if len(value) >= MaxAttributeValueBytes {
					t.Errorf("attribute %q is %d bytes, want under the %d cap", attr.Key, len(value), MaxAttributeValueBytes)
				}
			}
		})

		t.Run("still reaches the requested total payload size", func(t *testing.T) {
			target := 400 * 1024
			args := testSpanArgs()
			args.PayloadBytes = target
			total := jsonLen(BuildSpan(args).Attributes)

			// Within JSON structural overhead of the target.
			if total < target {
				t.Errorf("attribute payload is %d bytes, want at least %d", total, target)
			}
		})
	})

	t.Run("when a single oversized attribute is requested", func(t *testing.T) {
		t.Run("emits one attribute above the cap to exercise truncation", func(t *testing.T) {
			args := testSpanArgs()
			args.PayloadBytes = 300 * 1024
			args.SingleOversizedAttribute = true

			value := ""
			for _, attr := range BuildSpan(args).Attributes {
				if attr.Key == "langwatch.benchmark.filler" && attr.Value.StringValue != nil {
					value = *attr.Value.StringValue
				}
			}
			if len(value) <= MaxAttributeValueBytes {
				t.Errorf("filler is %d bytes, want above the %d cap", len(value), MaxAttributeValueBytes)
			}
		})
	})

	t.Run("given a parent span id", func(t *testing.T) {
		t.Run("includes it", func(t *testing.T) {
			args := testSpanArgs()
			args.ParentSpanID = strings.Repeat("c", 16)

			if got, want := BuildSpan(args).ParentSpanID, strings.Repeat("c", 16); got != want {
				t.Errorf("got %q, want %q", got, want)
			}
		})
	})

	t.Run("given no parent span id", func(t *testing.T) {
		t.Run("omits the field entirely rather than sending an empty string", func(t *testing.T) {
			encoded, err := json.Marshal(BuildSpan(testSpanArgs()))
			if err != nil {
				t.Fatalf("marshal failed: %v", err)
			}
			if strings.Contains(string(encoded), "parentSpanId") {
				t.Errorf("payload carries parentSpanId: %s", encoded)
			}
		})
	})
}

func TestBuildResourceSpans(t *testing.T) {
	t.Run("nests spans under resourceSpans and scopeSpans", func(t *testing.T) {
		body := BuildResourceSpans([]OtlpSpan{BuildSpan(testSpanArgs())}, "")

		if got := len(body.ResourceSpans[0].ScopeSpans[0].Spans); got != 1 {
			t.Errorf("nested span count = %d, want 1", got)
		}
	})

	t.Run("carries a service name resource attribute", func(t *testing.T) {
		body := BuildResourceSpans([]OtlpSpan{BuildSpan(testSpanArgs())}, "bench-svc")
		attr := body.ResourceSpans[0].Resource.Attributes[0]

		if attr.Key != "service.name" {
			t.Errorf("key = %q, want service.name", attr.Key)
		}
		if attr.Value.StringValue == nil || *attr.Value.StringValue != "bench-svc" {
			t.Errorf("value = %+v, want stringValue bench-svc", attr.Value)
		}
	})

	t.Run("given no service name", func(t *testing.T) {
		t.Run("falls back to the benchmark's own service name", func(t *testing.T) {
			body := BuildResourceSpans(nil, "")
			attr := body.ResourceSpans[0].Resource.Attributes[0]

			if attr.Value.StringValue == nil || *attr.Value.StringValue != "langwatch-ingestion-benchmark" {
				t.Errorf("value = %+v, want the default service name", attr.Value)
			}
		})
	})
}

func TestChunkSpans(t *testing.T) {
	tenSpans := func() []OtlpSpan {
		spans := make([]OtlpSpan, 10)
		for i := range spans {
			spans[i] = BuildSpan(testSpanArgs())
		}
		return spans
	}

	t.Run("splits into chunks of the requested size", func(t *testing.T) {
		chunks, err := ChunkSpans(tenSpans(), 3)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		want := []int{3, 3, 3, 1}
		if len(chunks) != len(want) {
			t.Fatalf("chunk count = %d, want %d", len(chunks), len(want))
		}
		for i, w := range want {
			if len(chunks[i]) != w {
				t.Errorf("chunk %d length = %d, want %d", i, len(chunks[i]), w)
			}
		}
	})

	t.Run("preserves every span", func(t *testing.T) {
		chunks, err := ChunkSpans(tenSpans(), 4)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		total := 0
		for _, c := range chunks {
			total += len(c)
		}
		if total != 10 {
			t.Errorf("flattened length = %d, want 10", total)
		}
	})

	t.Run("rejects a non-positive chunk size", func(t *testing.T) {
		_, err := ChunkSpans([]OtlpSpan{BuildSpan(testSpanArgs())}, 0)
		if err == nil || !strings.Contains(err.Error(), "perRequest") {
			t.Errorf("error = %v, want one mentioning perRequest", err)
		}
	})
}

func TestScatterAcrossConcurrentArrivals(t *testing.T) {
	numbered := func(n int) []string {
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf("%016d", i)
		}
		return out
	}

	t.Run("keeps every span", func(t *testing.T) {
		spans := numbered(50)
		scattered := ScatterAcrossConcurrentArrivals(spans, CreateRng(5))

		seen := map[string]int{}
		for _, s := range scattered {
			seen[s]++
		}
		for _, s := range spans {
			if seen[s] != 1 {
				t.Errorf("span %q appears %d times, want exactly once", s, seen[s])
			}
		}
		if len(scattered) != len(spans) {
			t.Errorf("length = %d, want %d", len(scattered), len(spans))
		}
	})

	t.Run("actually reorders, so the aggregate really is contended", func(t *testing.T) {
		spans := numbered(50)
		scattered := ScatterAcrossConcurrentArrivals(spans, CreateRng(5))

		same := true
		for i := range spans {
			if spans[i] != scattered[i] {
				same = false
				break
			}
		}
		if same {
			t.Error("scatter returned the original order, so nothing is contended")
		}
	})

	t.Run("is deterministic for a given seed", func(t *testing.T) {
		spans := numbered(20)
		a := ScatterAcrossConcurrentArrivals(spans, CreateRng(11))
		b := ScatterAcrossConcurrentArrivals(spans, CreateRng(11))

		for i := range a {
			if a[i] != b[i] {
				t.Fatalf("position %d differs between runs: %q vs %q", i, a[i], b[i])
			}
		}
	})

	t.Run("does not mutate the input", func(t *testing.T) {
		spans := numbered(10)
		before := append([]string(nil), spans...)
		ScatterAcrossConcurrentArrivals(spans, CreateRng(3))

		for i := range before {
			if spans[i] != before[i] {
				t.Fatalf("input mutated at %d: %q, want %q", i, spans[i], before[i])
			}
		}
	})
}

func TestSelectForResend(t *testing.T) {
	spansOf := func(n int) []OtlpSpan {
		spans := make([]OtlpSpan, n)
		for i := range spans {
			spans[i] = BuildSpan(testSpanArgs())
		}
		return spans
	}

	t.Run("given a zero fraction", func(t *testing.T) {
		t.Run("selects nothing", func(t *testing.T) {
			if got := len(SelectForResend(spansOf(20), 0, CreateRng(1))); got != 0 {
				t.Errorf("selected %d, want 0", got)
			}
		})
	})

	t.Run("given a fraction of one", func(t *testing.T) {
		t.Run("selects everything", func(t *testing.T) {
			if got := len(SelectForResend(spansOf(20), 1, CreateRng(1))); got != 20 {
				t.Errorf("selected %d, want 20", got)
			}
		})
	})

	t.Run("given a partial fraction", func(t *testing.T) {
		t.Run("selects roughly that proportion", func(t *testing.T) {
			picked := len(SelectForResend(spansOf(1000), 0.1, CreateRng(17)))

			if picked <= 50 || picked >= 150 {
				t.Errorf("selected %d of 1000 at fraction 0.1, want between 50 and 150", picked)
			}
		})
	})
}

func TestBurstify(t *testing.T) {
	t.Run("groups items into bursts of the requested size", func(t *testing.T) {
		bursts, err := Burstify([]int{1, 2, 3, 4, 5}, 2)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		want := []int{2, 2, 1}
		if len(bursts) != len(want) {
			t.Fatalf("burst count = %d, want %d", len(bursts), len(want))
		}
		for i, w := range want {
			if len(bursts[i]) != w {
				t.Errorf("burst %d length = %d, want %d", i, len(bursts[i]), w)
			}
		}
	})

	t.Run("rejects a non-positive burst size", func(t *testing.T) {
		_, err := Burstify([]int{1}, 0)
		if err == nil || !strings.Contains(err.Error(), "burstSize") {
			t.Errorf("error = %v, want one mentioning burstSize", err)
		}
	})
}
