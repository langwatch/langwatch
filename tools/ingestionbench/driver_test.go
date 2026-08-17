package ingestionbench

import (
	"slices"
	"testing"
)

// The stages share a tenant set and a ClickHouse table, so anything that makes
// two stages collide shows up as a correctness violation the pipeline never
// caused. These are the three ways that was possible.

func TestStageSeed(t *testing.T) {
	t.Run("given the three stages of one run", func(t *testing.T) {
		t.Run("gives each stage a different sequence", func(t *testing.T) {
			serial := stageSeed(1337, StageSerial)
			concurrent := stageSeed(1337, StageConcurrent)
			adversarial := stageSeed(1337, StageAdversarial)

			if serial == concurrent || concurrent == adversarial || serial == adversarial {
				t.Fatalf("stages share a seed: serial=%d concurrent=%d adversarial=%d",
					serial, concurrent, adversarial)
			}
		})

		t.Run("gives each stage a different first trace id", func(t *testing.T) {
			// The actual failure this prevents. Same seed meant HexID returned
			// the same first id in every stage, so stage 2's opening trace was
			// stage 1's trace under the same tenant — and the summary for it
			// counted both stages' spans.
			first := func(stage StageName) string {
				return HexID(16, CreateRng(stageSeed(1337, stage)))
			}
			if first(StageSerial) == first(StageConcurrent) {
				t.Error("serial and concurrent open with the same trace id")
			}
			if first(StageConcurrent) == first(StageAdversarial) {
				t.Error("concurrent and adversarial open with the same trace id")
			}
		})
	})

	t.Run("when the same run seed is used twice", func(t *testing.T) {
		t.Run("replays the same trace ids, so a failing run can be reproduced", func(t *testing.T) {
			// Asserting stageSeed(99, X) == stageSeed(99, X) would hold for any
			// implementation including a broken one. The property a replay
			// actually depends on is that the same -seed regenerates the same
			// spans, so this drives the generator twice and compares the ids.
			ids := func() []string {
				traces, err := generateStage(stageGen{
					Plan: StagePlan{
						Stage:           StageAdversarial,
						Tenants:         1,
						TracesPerTenant: 3,
						SpansPerTrace:   2,
					},
					Tenants: []Tenant{{ProjectID: "p1", APIKey: "k1"}},
					Seed:    99,
					NowMs:   1_800_000_000_000,
				})
				if err != nil {
					t.Fatalf("generateStage failed: %v", err)
				}
				out := make([]string, 0, len(traces))
				for _, trace := range traces {
					out = append(out, trace.TraceID)
				}
				return out
			}

			first, second := ids(), ids()
			if len(first) == 0 {
				t.Fatal("generated no traces")
			}
			if !slices.Equal(first, second) {
				t.Errorf("replay diverged: %v then %v", first, second)
			}
		})
	})
}

func TestGenerateStageTraceIDs(t *testing.T) {
	tenants := []Tenant{{ProjectID: "p1", APIKey: "k1"}, {ProjectID: "p2", APIKey: "k2"}}

	generate := func(t *testing.T, stage StageName) []generatedTrace {
		t.Helper()
		traces, err := generateStage(stageGen{
			Plan: StagePlan{
				Stage:           stage,
				Tenants:         2,
				TracesPerTenant: 2,
				SpansPerTrace:   2,
			},
			Tenants: tenants,
			Seed:    1337,
			NowMs:   1_800_000_000_000,
		})
		if err != nil {
			t.Fatalf("generateStage(%s) failed: %v", stage, err)
		}
		return traces
	}

	t.Run("given two stages of the same run", func(t *testing.T) {
		t.Run("shares no trace id between them", func(t *testing.T) {
			seen := map[string]StageName{}
			for _, stage := range []StageName{StageSerial, StageConcurrent, StageAdversarial} {
				for _, trace := range generate(t, stage) {
					if previous, clash := seen[trace.TraceID]; clash {
						t.Fatalf("stage %s reused trace id %s from stage %s",
							stage, trace.TraceID, previous)
					}
					seen[trace.TraceID] = stage
				}
			}
		})
	})
}

func TestBuildStageRequestsOrdering(t *testing.T) {
	spans := make([]OtlpSpan, 6)
	for i := range spans {
		spans[i] = OtlpSpan{SpanID: HexID(8, CreateRng(int64(i)))}
	}
	traces := []generatedTrace{{
		Tenant:  Tenant{ProjectID: "p1", APIKey: "k1"},
		TraceID: "trace-1",
		Spans:   spans,
	}}

	t.Run("when the stage does not ask for scattering", func(t *testing.T) {
		t.Run("keeps the spans in the order they were generated", func(t *testing.T) {
			// The serial stage's whole purpose. A shuffle here would make a
			// per-aggregate FIFO bug indistinguishable from the driver's own
			// reordering, which is the one thing this stage must not do.
			requests, err := buildStageRequests(
				StagePlan{Stage: StageSerial, SpansPerRequest: 1, ScatterAcrossRequests: false},
				traces,
				CreateRng(1337),
			)
			if err != nil {
				t.Fatalf("buildStageRequests failed: %v", err)
			}
			if len(requests) != len(spans) {
				t.Fatalf("got %d requests, want %d", len(requests), len(spans))
			}
			for i, request := range requests {
				if request.Spans[0].SpanID != spans[i].SpanID {
					t.Fatalf("request %d carries span %s, want %s",
						i, request.Spans[0].SpanID, spans[i].SpanID)
				}
			}
		})
	})

	t.Run("when the stage asks for scattering", func(t *testing.T) {
		t.Run("emits the spans in a different order", func(t *testing.T) {
			// Without this case, deleting the ScatterAcrossConcurrentArrivals
			// call would still pass the serial test above — only one half of the
			// conditional would be pinned.
			requests, err := buildStageRequests(
				StagePlan{Stage: StageAdversarial, SpansPerRequest: 1, ScatterAcrossRequests: true},
				traces,
				CreateRng(1337),
			)
			if err != nil {
				t.Fatalf("buildStageRequests failed: %v", err)
			}
			if len(requests) != len(spans) {
				t.Fatalf("got %d requests, want %d", len(requests), len(spans))
			}

			emitted := make([]string, 0, len(requests))
			for _, request := range requests {
				emitted = append(emitted, request.Spans[0].SpanID)
			}
			generated := make([]string, 0, len(spans))
			for _, span := range spans {
				generated = append(generated, span.SpanID)
			}

			if slices.Equal(emitted, generated) {
				t.Error("scattering left the order untouched")
			}

			// Reordered, never lost: the scatter is a permutation.
			sortedEmitted := slices.Clone(emitted)
			sortedGenerated := slices.Clone(generated)
			slices.Sort(sortedEmitted)
			slices.Sort(sortedGenerated)
			if !slices.Equal(sortedEmitted, sortedGenerated) {
				t.Error("scattering changed which spans were emitted, not just their order")
			}
		})
	})
}

func TestBurstWindows(t *testing.T) {
	t.Run("when the stage asked for steady arrival", func(t *testing.T) {
		t.Run("sends everything as one window", func(t *testing.T) {
			got := burstWindows(10, 0)
			if len(got) != 1 || got[0] != (window{from: 0, to: 10}) {
				t.Errorf("got %v, want one window covering all 10", got)
			}
		})
	})

	t.Run("when the stage asked for bursts", func(t *testing.T) {
		t.Run("splits into windows of the burst size", func(t *testing.T) {
			got := burstWindows(10, 4)
			want := []window{{0, 4}, {4, 8}, {8, 10}}
			if !slices.Equal(got, want) {
				t.Errorf("got %v, want %v", got, want)
			}
		})

		t.Run("covers every request exactly once", func(t *testing.T) {
			// The windows index into both the request and the result slice, so a
			// gap would silently skip requests and an overlap would have two
			// goroutines writing the same result.
			const total = 23
			covered := make([]int, total)
			for _, w := range burstWindows(total, 5) {
				for i := w.from; i < w.to; i++ {
					covered[i]++
				}
			}
			for i, n := range covered {
				if n != 1 {
					t.Fatalf("request %d covered %d times, want exactly 1", i, n)
				}
			}
		})
	})

	t.Run("when there is nothing to send", func(t *testing.T) {
		t.Run("produces no windows", func(t *testing.T) {
			if got := burstWindows(0, 5); len(got) != 0 {
				t.Errorf("got %v, want none", got)
			}
		})
	})
}
