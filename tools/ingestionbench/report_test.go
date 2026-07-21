package ingestionbench

import (
	"strings"
	"testing"
)

// newSample builds a resource sample with the defaults the TypeScript fixture
// used, so each test only states the field it cares about.
func newSample(over func(*ResourceSample)) ResourceSample {
	s := ResourceSample{
		AtMs:          1000,
		Target:        "clickhouse-0",
		CPUMillicores: 100,
		MemoryBytes:   100 * 1024 * 1024,
	}
	if over != nil {
		over(&s)
	}
	return s
}

// newResult builds a clean, passing stage result.
func newResult(over func(*StageResult)) StageResult {
	r := StageResult{
		Stage:          StageSerial,
		Description:    "serial stage",
		StartedAtMs:    0,
		FinishedAtMs:   10_000,
		SpansSent:      1000,
		SpansAccepted:  1000,
		SpansRejected:  0,
		RequestsSent:   1000,
		RequestsFailed: 0,
		Violations:     nil,
		Samples:        []ResourceSample{newSample(nil)},
	}
	if over != nil {
		over(&r)
	}
	return r
}

func TestStageDurationMs(t *testing.T) {
	t.Run("measures the elapsed window", func(t *testing.T) {
		got := StageDurationMs(newResult(func(r *StageResult) {
			r.StartedAtMs, r.FinishedAtMs = 500, 2500
		}))
		if got != 2000 {
			t.Errorf("got %d, want 2000", got)
		}
	})

	t.Run("never returns a negative duration on a clock skew", func(t *testing.T) {
		got := StageDurationMs(newResult(func(r *StageResult) {
			r.StartedAtMs, r.FinishedAtMs = 5000, 1000
		}))
		if got != 0 {
			t.Errorf("got %d, want 0", got)
		}
	})
}

func TestStageThroughputPerSecond(t *testing.T) {
	t.Run("divides accepted spans by elapsed seconds", func(t *testing.T) {
		got := StageThroughputPerSecond(newResult(func(r *StageResult) {
			r.SpansAccepted, r.StartedAtMs, r.FinishedAtMs = 500, 0, 10_000
		}))
		if got != 50 {
			t.Errorf("got %v, want 50", got)
		}
	})

	t.Run("uses accepted spans, not sent, so rejections do not inflate throughput", func(t *testing.T) {
		got := StageThroughputPerSecond(newResult(func(r *StageResult) {
			r.SpansSent, r.SpansAccepted = 1000, 400
			r.StartedAtMs, r.FinishedAtMs = 0, 10_000
		}))
		if got != 40 {
			t.Errorf("got %v, want 40", got)
		}
	})

	t.Run("returns zero for an instantaneous stage rather than dividing by zero", func(t *testing.T) {
		got := StageThroughputPerSecond(newResult(func(r *StageResult) {
			r.StartedAtMs, r.FinishedAtMs = 1000, 1000
		}))
		if got != 0 {
			t.Errorf("got %v, want 0", got)
		}
	})
}

func TestPeakHelpers(t *testing.T) {
	samples := []ResourceSample{
		newSample(func(s *ResourceSample) { s.CPUMillicores, s.MemoryBytes = 100, 10 }),
		newSample(func(s *ResourceSample) { s.CPUMillicores, s.MemoryBytes = 900, 5 }),
		newSample(func(s *ResourceSample) { s.CPUMillicores, s.MemoryBytes = 200, 99 }),
	}

	t.Run("finds peak cpu", func(t *testing.T) {
		if got := PeakCPUMillicores(samples); got != 900 {
			t.Errorf("got %d, want 900", got)
		}
	})

	t.Run("finds peak memory", func(t *testing.T) {
		if got := PeakMemoryBytes(samples); got != 99 {
			t.Errorf("got %d, want 99", got)
		}
	})

	t.Run("returns zero for no samples rather than a negative sentinel", func(t *testing.T) {
		if got := PeakCPUMillicores(nil); got != 0 {
			t.Errorf("got cpu %d, want 0", got)
		}
		if got := PeakMemoryBytes(nil); got != 0 {
			t.Errorf("got memory %d, want 0", got)
		}
	})
}

func TestPeaksByTarget(t *testing.T) {
	t.Run("reports the peak per pod, not a global peak", func(t *testing.T) {
		peaks := PeaksByTarget([]ResourceSample{
			newSample(func(s *ResourceSample) { s.Target, s.CPUMillicores = "ch-0", 100 }),
			newSample(func(s *ResourceSample) { s.Target, s.CPUMillicores = "ch-0", 400 }),
			newSample(func(s *ResourceSample) { s.Target, s.CPUMillicores = "ch-1", 250 }),
		})

		want := []TargetPeak{
			{Target: "ch-0", CPUMillicores: 400, MemoryBytes: 100 * 1024 * 1024},
			{Target: "ch-1", CPUMillicores: 250, MemoryBytes: 100 * 1024 * 1024},
		}
		if len(peaks) != len(want) {
			t.Fatalf("got %d peaks, want %d", len(peaks), len(want))
		}
		for i := range want {
			if peaks[i] != want[i] {
				t.Errorf("peak %d: got %+v, want %+v", i, peaks[i], want[i])
			}
		}
	})

	t.Run("sorts targets so the table is stable across runs", func(t *testing.T) {
		peaks := PeaksByTarget([]ResourceSample{
			newSample(func(s *ResourceSample) { s.Target = "z-pod" }),
			newSample(func(s *ResourceSample) { s.Target = "a-pod" }),
		})
		if len(peaks) != 2 || peaks[0].Target != "a-pod" || peaks[1].Target != "z-pod" {
			t.Errorf("got %+v, want a-pod then z-pod", peaks)
		}
	})
}

func TestRenderStageTable(t *testing.T) {
	t.Run("marks a clean stage as passing", func(t *testing.T) {
		if !strings.Contains(RenderStageTable([]StageResult{newResult(nil)}), "PASS") {
			t.Errorf("clean stage is not marked PASS")
		}
	})

	t.Run("marks a stage with violations as failing and counts them", func(t *testing.T) {
		table := RenderStageTable([]StageResult{newResult(func(r *StageResult) {
			r.Violations = []Violation{
				{Kind: ViolationLostSpans, TenantId: "t", Detail: "d"},
				{Kind: ViolationDoubleCounted, TenantId: "t", Detail: "d"},
			}
		})})
		if !strings.Contains(table, "**FAIL** (2)") {
			t.Errorf("table does not report the violation count: %s", table)
		}
	})

	t.Run("renders one row per stage", func(t *testing.T) {
		table := RenderStageTable([]StageResult{
			newResult(func(r *StageResult) { r.Stage = StageSerial }),
			newResult(func(r *StageResult) { r.Stage = StageConcurrent }),
			newResult(func(r *StageResult) { r.Stage = StageAdversarial }),
		})
		for _, stage := range []StageName{StageSerial, StageConcurrent, StageAdversarial} {
			if !strings.Contains(table, "`"+string(stage)+"`") {
				t.Errorf("table does not name stage %q", stage)
			}
		}
	})
}

func TestRenderCorrectnessSection(t *testing.T) {
	t.Run("when all stages pass", func(t *testing.T) {
		t.Run("states the invariants that were checked", func(t *testing.T) {
			section := RenderCorrectnessSection([]StageResult{newResult(nil)})
			for _, want := range []string{"no lost spans", "no double-counted", "no cross-tenant leakage"} {
				if !strings.Contains(section, want) {
					t.Errorf("section does not state %q", want)
				}
			}
		})
	})

	t.Run("when a stage fails", func(t *testing.T) {
		failing := []StageResult{
			newResult(func(r *StageResult) { r.Stage = StageSerial }),
			newResult(func(r *StageResult) {
				r.Stage = StageConcurrent
				r.Violations = []Violation{{Kind: ViolationLostSpans, TenantId: "t", Detail: "boom"}}
			}),
		}

		t.Run("names the failing stage", func(t *testing.T) {
			section := RenderCorrectnessSection(failing)
			if !strings.Contains(section, "**This run FAILED.**") {
				t.Errorf("section does not declare the run failed")
			}
			if !strings.Contains(section, "`"+string(StageConcurrent)+"`") {
				t.Errorf("section does not name the failing stage")
			}
		})

		t.Run("does not name stages that passed", func(t *testing.T) {
			section := RenderCorrectnessSection(failing)
			if strings.Contains(section, "### `"+string(StageSerial)+"`") {
				t.Errorf("section names a stage that passed")
			}
		})
	})
}

func TestMeasurementCaveat(t *testing.T) {
	cases := []struct{ it, want string }{
		{"states that the figures measure contention rather than capacity", "contention, not capacity"},
		{"states that resource figures never fail the run", "never fail the run"},
		{"points at a baseline rather than an absolute threshold", "never against an absolute threshold"},
	}
	for _, c := range cases {
		t.Run(c.it, func(t *testing.T) {
			if !strings.Contains(MeasurementCaveat, c.want) {
				t.Errorf("caveat does not contain %q", c.want)
			}
		})
	}
}

func TestRenderJobSummary(t *testing.T) {
	summary := func() string {
		return RenderJobSummary(RenderJobSummaryOptions{
			Results:               []StageResult{newResult(nil)},
			Scale:                 1,
			ProjectedPayloadBytes: 40 * 1024 * 1024,
			RunnerLabel:           "ubuntu-latest",
		})
	}

	t.Run("leads with the caveat so it is read before the numbers", func(t *testing.T) {
		body := summary()
		caveat := strings.Index(body, "contention, not capacity")
		stages := strings.Index(body, "## Stages")
		if caveat < 0 || stages < 0 || caveat >= stages {
			t.Errorf("caveat at %d, stages at %d — caveat must come first", caveat, stages)
		}
	})

	t.Run("records the runner it ran on, since the numbers are runner-specific", func(t *testing.T) {
		if !strings.Contains(summary(), "ubuntu-latest") {
			t.Errorf("summary does not record the runner")
		}
	})

	t.Run("records the scale so two runs can be compared like for like", func(t *testing.T) {
		if !strings.Contains(summary(), "**Scale:** `1`") {
			t.Errorf("summary does not record the scale")
		}
	})

	t.Run("points at the raw sample artifact", func(t *testing.T) {
		if !strings.Contains(summary(), "ingestion-benchmark-samples") {
			t.Errorf("summary does not point at the raw sample artifact")
		}
	})

	t.Run("surfaces rejected spans, which are otherwise invisible behind a 2xx", func(t *testing.T) {
		body := RenderJobSummary(RenderJobSummaryOptions{
			Results: []StageResult{newResult(func(r *StageResult) {
				r.SpansAccepted, r.SpansRejected = 900, 100
			})},
			Scale:                 1,
			ProjectedPayloadBytes: 1024,
			RunnerLabel:           "ubuntu-latest",
		})
		if !strings.Contains(body, "100 rejected") {
			t.Errorf("summary does not surface rejected spans: %s", body)
		}
	})
}

func TestFormatThousands(t *testing.T) {
	cases := []struct {
		n    int
		want string
	}{
		{0, "0"},
		{999, "999"},
		{1000, "1,000"},
		{1234567, "1,234,567"},
		{-1234, "-1,234"},
	}
	for _, c := range cases {
		t.Run("groups "+c.want, func(t *testing.T) {
			if got := formatThousands(c.n); got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestPct(t *testing.T) {
	t.Run("when the denominator is zero", func(t *testing.T) {
		t.Run("renders n/a rather than NaN", func(t *testing.T) {
			if got := pct(0, 0); got != "n/a" {
				t.Errorf("got %q, want %q", got, "n/a")
			}
		})
	})

	t.Run("when there is a denominator", func(t *testing.T) {
		t.Run("renders one decimal place", func(t *testing.T) {
			if got := pct(1, 3); got != "33.3%" {
				t.Errorf("got %q, want %q", got, "33.3%")
			}
		})
	})
}
