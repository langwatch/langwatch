package visualdiff

import (
	"context"
	"io"
	"os"
	"strings"
	"testing"
)

// @scenario "A run refuses to start on battery, under load or beside another visualdiff stack"
func TestARunRefusesBadConditionsUpFront(t *testing.T) {
	t.Run("each condition is a reason, and a quiet machine has none", func(t *testing.T) {
		reasons := Refusals(Conditions{OnBattery: true, Load: 31.5, LiveStacks: []string{"visualdiff-x-candidate"}}, 20)
		if len(reasons) != 3 || !strings.Contains(reasons[1], "31.5") || !strings.Contains(reasons[2], "visualdiff-x-candidate") {
			t.Fatalf("reasons: %v", reasons)
		}
		if got := Refusals(Conditions{Load: 19.9}, 20); len(got) != 0 {
			t.Fatalf("a load under the limit refused: %v", got)
		}
	})

	loaded := func(context.Context, Options) Conditions { return Conditions{Load: 25, CPUs: 16} }
	t.Run("a refused run starts nothing and leaves no run directory", func(t *testing.T) {
		options := testOptions(t)
		fake := &fakeRunner{}
		deps := passingDeps(fake, nil, nil)
		deps.Conditions = loaded
		_, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard})
		if err == nil || !strings.Contains(err.Error(), "-force runs anyway") {
			t.Fatalf("want a refusal naming -force, got %v", err)
		}
		if len(fake.commands) != 0 {
			t.Fatalf("a refused run ran %v", fake.rendered())
		}
		if _, statErr := os.Stat(options.RunDir); !os.IsNotExist(statErr) {
			t.Fatal("a refused run created its directory, which would cost the previous run its report")
		}
	})

	t.Run("-force runs anyway, on fewer pages", func(t *testing.T) {
		options := testOptions(t)
		options.Force = true
		deps := passingDeps(&fakeRunner{}, nil, nil)
		deps.Conditions = loaded
		var handed RunnerPlan
		deps.Capture = func(_ context.Context, plan RunnerPlan, _ CaptureOptions) (RunnerStream, error) {
			handed = plan
			return RunnerStream{}, nil
		}
		if _, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard}); err != nil {
			t.Fatal(err)
		}
		if handed.Concurrency != (Concurrency{Routes: 1, Flows: 1}) {
			t.Fatalf("a machine with no CPU free still got %+v pages", handed.Concurrency)
		}
	})
}

func TestPagesDefaultToHalfTheCPUsAndShrinkUnderLoad(t *testing.T) {
	cases := []struct {
		asked      int
		conditions Conditions
		want       int
	}{
		{0, Conditions{CPUs: 16, Load: 2}, 8},
		{0, Conditions{CPUs: 16, Load: 11.2}, 4},
		{12, Conditions{CPUs: 16, Load: -1}, 12},
		{0, Conditions{CPUs: 4, Load: 9}, 1},
	}
	for _, each := range cases {
		if got := PageWidth(each.asked, each.conditions); got != each.want {
			t.Errorf("PageWidth(%d, %+v) = %d, want %d", each.asked, each.conditions, got, each.want)
		}
	}
}

func TestParseLoadReadsBothPlatforms(t *testing.T) {
	if got := ParseLoad("{ 3.25 2.10 1.00 }\n"); got != 3.25 {
		t.Errorf("sysctl: %v", got)
	}
	if got := ParseLoad("0.50 0.40 0.30 1/200 999\n"); got != 0.5 {
		t.Errorf("/proc/loadavg: %v", got)
	}
	if got := ParseLoad(""); got != -1 {
		t.Errorf("unreadable: %v", got)
	}
}
