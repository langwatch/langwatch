package ingestionbench

import (
	"strings"
	"testing"
	"time"
)

// mustPlan fails the test if planning is refused; used by every case that
// expects a valid plan.
func mustPlan(t *testing.T, scale float64, byteBudget int) BenchmarkPlan {
	t.Helper()
	plan, err := PlanBenchmark(scale, byteBudget)
	if err != nil {
		t.Fatalf("PlanBenchmark(%v, %d) failed: %v", scale, byteBudget, err)
	}
	return plan
}

func TestPlanBenchmark(t *testing.T) {
	t.Run("given the default scale", func(t *testing.T) {
		t.Run("plans all three stages in order", func(t *testing.T) {
			plan := mustPlan(t, 1, 0)

			want := []StageName{StageSerial, StageConcurrent, StageAdversarial}
			if len(plan.Stages) != len(want) {
				t.Fatalf("stage count = %d, want %d", len(plan.Stages), len(want))
			}
			for i, w := range want {
				if plan.Stages[i].Stage != w {
					t.Errorf("stage %d = %q, want %q", i, plan.Stages[i].Stage, w)
				}
			}
		})

		t.Run("stays well inside the byte budget", func(t *testing.T) {
			plan := mustPlan(t, 1, 0)

			if plan.ProjectedPayloadBytes >= DefaultByteBudget {
				t.Errorf("projected %d bytes, want under the %d budget", plan.ProjectedPayloadBytes, DefaultByteBudget)
			}
		})

		t.Run("keeps the default workload small enough that disk is not the constraint", func(t *testing.T) {
			plan := mustPlan(t, 1, 0)

			// Even at a pessimistic 6x on-disk multiplier this must stay far below
			// the runner's free space, or a full volume kills the run and we learn
			// nothing. 1 GiB of projected on-disk is the line.
			if got := plan.ProjectedPayloadBytes * 6; got >= 1024*1024*1024 {
				t.Errorf("projected on-disk %d bytes, want under 1 GiB", got)
			}
		})
	})

	t.Run("given the serial stage", func(t *testing.T) {
		serial := func(t *testing.T) StagePlan { return mustPlan(t, 1, 0).Stages[0] }

		t.Run("drives one trace on one tenant so every span hits the same aggregate", func(t *testing.T) {
			s := serial(t)
			if s.Tenants != 1 {
				t.Errorf("tenants = %d, want 1", s.Tenants)
			}
			if s.TracesPerTenant != 1 {
				t.Errorf("tracesPerTenant = %d, want 1", s.TracesPerTenant)
			}
		})

		t.Run("sends one span per request with no concurrency", func(t *testing.T) {
			s := serial(t)
			if s.SpansPerRequest != 1 {
				t.Errorf("spansPerRequest = %d, want 1", s.SpansPerRequest)
			}
			if s.Concurrency != 1 {
				t.Errorf("concurrency = %d, want 1", s.Concurrency)
			}
		})

		t.Run("does not scatter or resend, keeping the stage strictly sequential", func(t *testing.T) {
			s := serial(t)
			if s.ScatterAcrossRequests {
				t.Error("scatterAcrossRequests = true, want false")
			}
			if s.ResendFraction != 0 {
				t.Errorf("resendFraction = %v, want 0", s.ResendFraction)
			}
		})
	})

	t.Run("given the concurrent stage", func(t *testing.T) {
		t.Run("spreads load across several tenants to expose unfair dispatch", func(t *testing.T) {
			c := mustPlan(t, 1, 0).Stages[1]

			if c.Tenants <= 1 {
				t.Errorf("tenants = %d, want more than 1", c.Tenants)
			}
			if c.Concurrency <= 1 {
				t.Errorf("concurrency = %d, want more than 1", c.Concurrency)
			}
		})
	})

	t.Run("given the adversarial stage", func(t *testing.T) {
		adversarial := func(t *testing.T) StagePlan { return mustPlan(t, 1, 0).Stages[2] }

		t.Run("scatters spans across concurrent arrivals to contend on one aggregate", func(t *testing.T) {
			if !adversarial(t).ScatterAcrossRequests {
				t.Error("scatterAcrossRequests = false, want true")
			}
		})

		t.Run("resends a fraction of spans to probe the dedup gate", func(t *testing.T) {
			if got := adversarial(t).ResendFraction; got <= 0 {
				t.Errorf("resendFraction = %v, want greater than 0", got)
			}
		})

		t.Run("straddles the offload threshold from both sides", func(t *testing.T) {
			a := adversarial(t)

			if a.SizeMix.NearThresholdSpans <= 0 {
				t.Errorf("nearThresholdSpans = %d, want greater than 0", a.SizeMix.NearThresholdSpans)
			}
			if a.SizeMix.OverThresholdSpans <= 0 {
				t.Errorf("overThresholdSpans = %d, want greater than 0", a.SizeMix.OverThresholdSpans)
			}
			if NearThresholdBytes >= CommandInlineThresholdBytes {
				t.Errorf("near bucket is %d bytes, want under the %d threshold", NearThresholdBytes, CommandInlineThresholdBytes)
			}
			if OverThresholdBytes <= CommandInlineThresholdBytes {
				t.Errorf("over bucket is %d bytes, want above the %d threshold", OverThresholdBytes, CommandInlineThresholdBytes)
			}
		})

		t.Run("interleaves multiple tenants so leakage has somewhere to leak to", func(t *testing.T) {
			if got := adversarial(t).Tenants; got <= 1 {
				t.Errorf("tenants = %d, want more than 1", got)
			}
		})
	})

	t.Run("when scale is raised", func(t *testing.T) {
		t.Run("increases the total span count", func(t *testing.T) {
			base := mustPlan(t, 1, 0)
			bigger := mustPlan(t, 3, 0)

			if bigger.TotalSpans <= base.TotalSpans {
				t.Errorf("totalSpans at scale 3 = %d, want more than %d at scale 1", bigger.TotalSpans, base.TotalSpans)
			}
		})

		t.Run("does not move the payload sizes calibrated against real thresholds", func(t *testing.T) {
			base := mustPlan(t, 1, 0).Stages[2]
			bigger := mustPlan(t, 5, 0).Stages[2]

			// Scaling these would stop the stage testing the offload boundary.
			if bigger.SizeMix.NearThresholdSpans != base.SizeMix.NearThresholdSpans {
				t.Errorf("nearThresholdSpans moved from %d to %d", base.SizeMix.NearThresholdSpans, bigger.SizeMix.NearThresholdSpans)
			}
			if bigger.SizeMix.OverThresholdSpans != base.SizeMix.OverThresholdSpans {
				t.Errorf("overThresholdSpans moved from %d to %d", base.SizeMix.OverThresholdSpans, bigger.SizeMix.OverThresholdSpans)
			}
		})
	})

	t.Run("when scale would exceed the byte budget", func(t *testing.T) {
		t.Run("refuses to plan rather than dying mid-run on a full volume", func(t *testing.T) {
			_, err := PlanBenchmark(1, 1024)

			if err == nil || !strings.Contains(err.Error(), "budget") {
				t.Errorf("error = %v, want a refusal naming the budget", err)
			}
		})

		t.Run("names the scale so the operator knows which knob to turn", func(t *testing.T) {
			_, err := PlanBenchmark(7, 1024)

			if err == nil || !strings.Contains(err.Error(), "currently 7") {
				t.Errorf("error = %v, want one naming the current scale", err)
			}
		})
	})

	t.Run("when scale is not a positive number", func(t *testing.T) {
		for name, scale := range map[string]float64{"rejects zero": 0, "rejects negatives": -2} {
			t.Run(name, func(t *testing.T) {
				_, err := PlanBenchmark(scale, 0)

				if err == nil || !strings.Contains(err.Error(), "positive") {
					t.Errorf("error = %v, want one mentioning a positive scale", err)
				}
			})
		}
	})
}

func TestStageSpanTotal(t *testing.T) {
	t.Run("multiplies tenants by traces by spans", func(t *testing.T) {
		plan := mustPlan(t, 1, 0).Stages[1]

		want := plan.Tenants * plan.TracesPerTenant * plan.SpansPerTrace
		if got := StageSpanTotal(plan); got != want {
			t.Errorf("got %d, want %d", got, want)
		}
	})
}

func TestStagePayloadBytes(t *testing.T) {
	t.Run("weights large spans far above small ones", func(t *testing.T) {
		stages := mustPlan(t, 1, 0).Stages
		serial, adversarial := stages[0], stages[2]

		// The adversarial stage sends fewer spans in the large buckets but far
		// more bytes, which is exactly why those buckets are not scaled.
		if StagePayloadBytes(adversarial) <= StagePayloadBytes(serial) {
			t.Errorf("adversarial %d bytes, want more than serial's %d",
				StagePayloadBytes(adversarial), StagePayloadBytes(serial))
		}
	})
}

func TestAssertWithinBudget(t *testing.T) {
	t.Run("when the plan fits", func(t *testing.T) {
		t.Run("accepts it", func(t *testing.T) {
			if err := AssertWithinBudget(mustPlan(t, 1, 0)); err != nil {
				t.Errorf("unexpected refusal: %v", err)
			}
		})
	})

	t.Run("when the plan overshoots", func(t *testing.T) {
		t.Run("refuses it", func(t *testing.T) {
			plan := BenchmarkPlan{Scale: 1, ProjectedPayloadBytes: 2048, ByteBudget: 1024}

			if err := AssertWithinBudget(plan); err == nil {
				t.Error("expected a refusal, got nil")
			}
		})
	})
}

func TestAssertSpanTimestampIsAccepted(t *testing.T) {
	t.Run("when the span is recent", func(t *testing.T) {
		t.Run("accepts it", func(t *testing.T) {
			now := time.Now().UnixMilli()

			if err := AssertSpanTimestampIsAccepted(now-60_000, now); err != nil {
				t.Errorf("unexpected rejection: %v", err)
			}
		})
	})

	t.Run("when the span is older than the receiver's cutoff", func(t *testing.T) {
		t.Run("rejects it so the run does not misreport a rejection as data loss", func(t *testing.T) {
			now := time.Now().UnixMilli()

			err := AssertSpanTimestampIsAccepted(now-MaxPastSkewMs-1, now)
			if err == nil || !strings.Contains(err.Error(), "would be rejected by design") {
				t.Errorf("error = %v, want one explaining the rejection is by design", err)
			}
		})
	})
}

func TestFormatBytes(t *testing.T) {
	cases := []struct {
		name  string
		bytes int
		want  string
	}{
		{"renders bytes", 512, "512 B"},
		{"renders kibibytes", 2048, "2.0 KiB"},
		{"renders mebibytes", 5 * 1024 * 1024, "5.0 MiB"},
		{"renders gibibytes", 3 * 1024 * 1024 * 1024, "3.00 GiB"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := FormatBytes(int64(c.bytes)); got != c.want {
				t.Errorf("FormatBytes(%d) = %q, want %q", c.bytes, got, c.want)
			}
		})
	}
}
