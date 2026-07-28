// Package ingestionbench drives the event-sourcing ingestion benchmark.
//
// This file holds deterministic OTLP/HTTP JSON payload construction.
//
// PURE and SEEDED. Two runs with the same seed produce byte-identical
// payloads, which is what makes a failure reproducible: when a stage reports a
// missing span you can replay the exact same stream locally instead of trying
// to catch a random one again.
//
// The wire shape mirrors `scripts/dogfood/governance/emit-otlp.sh`, which is
// the existing hand-rolled emitter for this same receiver.
package ingestionbench

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Rng is a seeded source of floats in [0, 1).
type Rng func() float64

// CreateRng returns a Mulberry32 generator — small, fast, seeded. Deterministic
// across platforms, and bit-for-bit identical to the TypeScript original: every
// step is uint32 arithmetic, which is exactly what JavaScript's `>>> 0`,
// `Math.imul`, and the ToInt32 coercion performed by `^` and `|` amount to.
// The seed is taken as int64 and truncated to 32 bits, mirroring the
// TypeScript original's `seed >>> 0`.
func CreateRng(seed int64) Rng {
	a := uint32(seed)
	return func() float64 {
		a = a + 0x6d2b79f5
		t := a
		t = (t ^ (t >> 15)) * (t | 1)
		t ^= t + (t^(t>>7))*(t|61)
		return float64(t^(t>>14)) / 4294967296
	}
}

// HexID returns a lowercase hex id of `bytes` length, drawn from the seeded rng.
func HexID(bytes int, rng Rng) string {
	var out strings.Builder
	for i := 0; i < bytes; i++ {
		b := int(math.Floor(rng() * 256))
		out.WriteString(fmt.Sprintf("%02x", b))
	}
	return out.String()
}

// FillerOfBytes returns a filler string of EXACTLY `bytes` bytes when UTF-8
// encoded.
//
// Uses ASCII so byte length equals string length, and varies the content so
// ZSTD cannot compress the whole benchmark down to nothing — a payload that
// compresses to zero would not exercise the size branch it is meant to test.
func FillerOfBytes(bytes int, rng Rng) string {
	if bytes <= 0 {
		return ""
	}
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 0, bytes)
	for len(out) < bytes {
		out = append(out, alphabet[int(math.Floor(rng()*float64(len(alphabet))))])
	}
	return string(out[:bytes])
}

// otlpValue is the OTLP AnyValue union as used by this benchmark. Exactly one
// field is ever set; the pointers make the other one vanish from the JSON, so
// the wire bytes match the TypeScript union verbatim.
type otlpValue struct {
	StringValue *string `json:"stringValue,omitempty"`
	IntValue    *string `json:"intValue,omitempty"`
}

func stringValue(s string) otlpValue { return otlpValue{StringValue: &s} }

// OtlpKeyValue is a single OTLP attribute.
type OtlpKeyValue struct {
	Key   string    `json:"key"`
	Value otlpValue `json:"value"`
}

// OtlpSpan is a single span in OTLP/HTTP JSON form.
type OtlpSpan struct {
	TraceID string `json:"traceId"`
	SpanID  string `json:"spanId"`
	// Omitted entirely when empty, rather than sent as an empty string.
	ParentSpanID      string         `json:"parentSpanId,omitempty"`
	Name              string         `json:"name"`
	Kind              int            `json:"kind"`
	StartTimeUnixNano string         `json:"startTimeUnixNano"`
	EndTimeUnixNano   string         `json:"endTimeUnixNano"`
	Attributes        []OtlpKeyValue `json:"attributes"`
	Status            struct {
		Code int `json:"code"`
	} `json:"status"`
}

type otlpScopeSpans struct {
	Scope struct {
		Name string `json:"name"`
	} `json:"scope"`
	Spans []OtlpSpan `json:"spans"`
}

type otlpResourceSpan struct {
	Resource struct {
		Attributes []OtlpKeyValue `json:"attributes"`
	} `json:"resource"`
	ScopeSpans []otlpScopeSpans `json:"scopeSpans"`
}

// OtlpResourceSpans is a whole OTLP/HTTP request body.
type OtlpResourceSpans struct {
	ResourceSpans []otlpResourceSpan `json:"resourceSpans"`
}

// MaxAttributeValueBytes is the largest a SINGLE attribute value may be before
// `capOversizedAttributes` replaces it with a placeholder. Crossing this is
// TRUNCATION — the span still arrives, but its content is rewritten.
const MaxAttributeValueBytes = 256 * 1024

// fillerChunkBytes keeps filler chunks comfortably under the per-attribute cap
// so a large payload crosses the WHOLE-COMMAND spool threshold without any
// single value tripping truncation. These are two different 256 KB constants
// with two different behaviours, and conflating them produces a benchmark that
// thinks it is testing the offload path while actually testing the truncation
// path.
const fillerChunkBytes = 48 * 1024

// BuildSpanArgs are the inputs to BuildSpan.
type BuildSpanArgs struct {
	TraceID      string
	SpanID       string
	ParentSpanID string
	Name         string
	// StartMs is the wall-clock start, in ms. Converted to the nanos OTLP
	// expects.
	StartMs    int64
	DurationMs int64
	// PayloadBytes is the target total byte size for the span's attribute
	// payload, spread across as many attributes as needed to stay under the
	// per-attribute cap.
	PayloadBytes int
	// SingleOversizedAttribute emits the filler as ONE oversized attribute
	// instead of chunking, deliberately tripping `capOversizedAttributes`. Used
	// to prove truncation does not lose the span itself.
	SingleOversizedAttribute bool
	// Markers are marker attributes so a stored span can be traced back to its
	// stage. Emitted in sorted key order — Go maps have no insertion order, and
	// the payload must stay byte-identical between runs.
	Markers map[string]string
	Rng     Rng
}

const nanosPerMs = 1_000_000

// MsToUnixNano converts milliseconds to the nanosecond string OTLP expects.
func MsToUnixNano(ms int64) string {
	return strconv.FormatInt(ms*nanosPerMs, 10)
}

// BuildSpan builds one span, padded to the requested payload size.
func BuildSpan(args BuildSpanArgs) OtlpSpan {
	keys := make([]string, 0, len(args.Markers))
	for k := range args.Markers {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	attributes := make([]OtlpKeyValue, 0, len(keys)+1)
	for _, k := range keys {
		attributes = append(attributes, OtlpKeyValue{Key: k, Value: stringValue(args.Markers[k])})
	}

	// Pad to the requested size. The marker overhead is subtracted so
	// PayloadBytes describes the whole attribute payload, which is what the
	// whole-command spool check measures.
	markerBytes := jsonLen(attributes)
	remaining := args.PayloadBytes - markerBytes

	if remaining > 0 {
		if args.SingleOversizedAttribute {
			attributes = append(attributes, OtlpKeyValue{
				Key:   "langwatch.benchmark.filler",
				Value: stringValue(FillerOfBytes(remaining, args.Rng)),
			})
		} else {
			index := 0
			for remaining > 0 {
				chunk := remaining
				if chunk > fillerChunkBytes {
					chunk = fillerChunkBytes
				}
				attributes = append(attributes, OtlpKeyValue{
					Key:   fmt.Sprintf("langwatch.benchmark.filler.%d", index),
					Value: stringValue(FillerOfBytes(chunk, args.Rng)),
				})
				remaining -= chunk
				index++
			}
		}
	}

	span := OtlpSpan{
		TraceID:           args.TraceID,
		SpanID:            args.SpanID,
		ParentSpanID:      args.ParentSpanID,
		Name:              args.Name,
		Kind:              1,
		StartTimeUnixNano: MsToUnixNano(args.StartMs),
		EndTimeUnixNano:   MsToUnixNano(args.StartMs + args.DurationMs),
		Attributes:        attributes,
	}
	span.Status.Code = 1
	return span
}

// jsonLen is the serialised length of a value, matching what the TypeScript
// original measured with `JSON.stringify(...).length`.
func jsonLen(v any) int {
	buf, err := json.Marshal(v)
	if err != nil {
		return 0
	}
	return len(buf)
}

// BuildResourceSpans wraps spans into a single OTLP/HTTP request body.
//
// serviceName is variadic to stand in for the TypeScript original's optional
// argument; omitted or empty means "langwatch-ingestion-benchmark".
func BuildResourceSpans(spans []OtlpSpan, serviceNameOpt ...string) OtlpResourceSpans {
	serviceName := "langwatch-ingestion-benchmark"
	if len(serviceNameOpt) > 0 && serviceNameOpt[0] != "" {
		serviceName = serviceNameOpt[0]
	}
	var scope otlpScopeSpans
	scope.Scope.Name = "langwatch.benchmark"
	scope.Spans = spans

	var rs otlpResourceSpan
	rs.Resource.Attributes = []OtlpKeyValue{
		{Key: "service.name", Value: stringValue(serviceName)},
	}
	rs.ScopeSpans = []otlpScopeSpans{scope}

	return OtlpResourceSpans{ResourceSpans: []otlpResourceSpan{rs}}
}

// ChunkSpans splits a span list into request-sized chunks.
func ChunkSpans(spans []OtlpSpan, perRequest int) ([][]OtlpSpan, error) {
	if perRequest <= 0 {
		return nil, errors.New("perRequest must be >= 1")
	}
	chunks := [][]OtlpSpan{}
	for i := 0; i < len(spans); i += perRequest {
		end := i + perRequest
		if end > len(spans) {
			end = len(spans)
		}
		chunks = append(chunks, spans[i:end])
	}
	return chunks, nil
}

// ScatterAcrossConcurrentArrivals shuffles spans so a trace's spans are spread
// across many concurrent requests rather than arriving as one ordered run.
//
// ---------------------------------------------------------------------------
// Read this before "fixing" it to sort by timestamp
// ---------------------------------------------------------------------------
// A client CANNOT send an out-of-order `occurredAt`. The envelope's
// `occurredAt` is stamped at ingest time
// (`trace-request-collection.service.ts`), NOT taken from the span's
// `startTimeUnixNano`. So arrival order and `occurredAt` order are identical
// by construction, no matter what timestamps the payload carries.
//
// Out-of-order folding arises INSIDE the pipeline: when spans for one
// aggregate are processed concurrently — across dispatch shards
// (`TRACE_SPAN_PROCESSING_SHARDS > 1`), or through a retry that restages a
// batch behind newer work — the fold sees an event whose `occurredAt`
// precedes its persisted checkpoint.
//
// The only lever a load driver has is to maximise the chance of that
// concurrency: scatter one trace's spans across many in-flight requests so
// they contend for the same aggregate. That is what this does. Sorting the
// spans back into order would remove the contention and quietly turn the
// adversarial stage into a second serial stage.
//
// The input slice is not mutated.
func ScatterAcrossConcurrentArrivals[T any](spans []T, rng Rng) []T {
	out := make([]T, len(spans))
	copy(out, spans)
	// Fisher-Yates, seeded — reproducible scatter.
	for i := len(out) - 1; i > 0; i-- {
		j := int(math.Floor(rng() * float64(i+1)))
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// SelectForResend picks a subset of spans to send a SECOND time.
//
// Re-sending is the cheapest available probe for the double-count bug. The
// ingest path holds a `(tenantId, traceId, spanId)` dedup lock, so a resend
// must be discarded and `trace_summaries.SpanCount` must NOT move. If it
// does, a retried batch is being re-applied to the fold — which is precisely
// the accumulation bug this benchmark exists to catch.
func SelectForResend(spans []OtlpSpan, fraction float64, rng Rng) []OtlpSpan {
	if fraction <= 0 {
		return []OtlpSpan{}
	}
	out := []OtlpSpan{}
	for _, s := range spans {
		if rng() < fraction {
			out = append(out, s)
		}
	}
	return out
}

// Burstify groups items into bursts: long idle gaps punctuated by dense
// clusters. Returned as slices of request-chunks to fire back to back.
func Burstify[T any](items []T, burstSize int) ([][]T, error) {
	if burstSize <= 0 {
		return nil, errors.New("burstSize must be >= 1")
	}
	bursts := [][]T{}
	for i := 0; i < len(items); i += burstSize {
		end := i + burstSize
		if end > len(items) {
			end = len(items)
		}
		bursts = append(bursts, items[i:end])
	}
	return bursts, nil
}
