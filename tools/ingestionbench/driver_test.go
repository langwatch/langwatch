package ingestionbench

import (
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
		t.Run("replays identically, so a failing run can be reproduced", func(t *testing.T) {
			if stageSeed(99, StageAdversarial) != stageSeed(99, StageAdversarial) {
				t.Error("stageSeed is not deterministic")
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
}
