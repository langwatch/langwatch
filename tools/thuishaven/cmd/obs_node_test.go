package cmd

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain/nodeprofile"
)

const fixtures = "../domain/nodeprofile/testdata/"

// @scenario "Load is driven during the window on request"
func TestProfileOptions(t *testing.T) {
	inv := func(flags map[string]string) invocation { return invocation{flags: flags} }
	o, err := readProfileOptions(inv(map[string]string{}))
	if err != nil || o.window != 30*time.Second || o.limit != 15 || o.loadRate != 0 {
		t.Errorf("defaults = %+v, %v", o, err)
	}
	o, err = readProfileOptions(inv(map[string]string{"--duration": "10s", "--limit": "5", "--load": "telemetry:50"}))
	if err != nil || o.window != 10*time.Second || o.limit != 5 || o.loadRate != 50 {
		t.Errorf("parsed = %+v, %v", o, err)
	}
	for _, bad := range []map[string]string{
		{"--load": "50"}, {"--load": "telemetry:"}, {"--load": "telemetry:-1"}, {"--load": "llm:5"},
		{"--limit": "0"}, {"--limit": "x"}, {"--duration": "soon"},
	} {
		if _, err := readProfileOptions(inv(bad)); ExitCode(err) != exitUsage {
			t.Errorf("%v exited %d (%v), want %d", bad, ExitCode(err), err, exitUsage)
		}
	}
}

// @scenario "Two CPU profiles compare"
func TestObsCompare_TwoNamedProfiles(t *testing.T) {
	var runErr error
	out := captureStdout(t, func() {
		runErr = runObsCompare(context.Background(), deps{}, invocation{
			flags: map[string]string{},
			args:  []string{fixtures + "before.cpuprofile", fixtures + "after.cpuprofile"},
		})
	})
	if runErr != nil {
		t.Fatal(runErr)
	}
	for _, want := range []string{
		"haven obs compare: before -> after",
		"before    0.0 s   busy 73.3 %   gc 6.7 %",
		"change    busy -23.3 pt   gc -6.7 pt",
		"walk", "apps/api/src/walk.ts:1",
		"modules/traces/process/src/services/ingest.service.ts:48",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("compare output lacks %q:\n%s", want, out)
		}
	}
	if strings.Index(out, "walk") > strings.Index(out, "handle") {
		t.Errorf("walk moved most and should come first:\n%s", out)
	}
}

// @scenario "Two CPU profiles compare"
func TestObsCompare_RefusesOneProfilePath(t *testing.T) {
	err := runObsCompare(context.Background(), deps{}, invocation{flags: map[string]string{}, args: []string{"a.cpuprofile"}})
	if ExitCode(err) != exitUsage {
		t.Errorf("exit %d (%v), want %d", ExitCode(err), err, exitUsage)
	}
}

// @scenario "A CPU profile is saved with a summary"
func TestPrintCPUReport_OneScreenWithUnitsAndThePathAlone(t *testing.T) {
	raw, err := os.ReadFile(fixtures + "before.cpuprofile")
	if err != nil {
		t.Fatal(err)
	}
	p, err := nodeprofile.ParseCPUProfile(raw)
	if err != nil {
		t.Fatal(err)
	}
	path := "/repo/.claude/tmp/haven-profiles/feat-x/api-20261023-120000.cpuprofile"
	var b bytes.Buffer
	printCPUReport(&b, cpuReport{
		profileTarget: profileTarget{Stack: "feat-x", Lane: "api", PID: 102, Also: []string{"workers"}}, Profile: path,
		Inspector: inspectorNote{Port: 51234, Opened: true},
		Memory:    &memoryMB{RSS: 812, HeapUsed: 410, HeapTotal: 520, External: 40},
		Load:      &loadRun{Preset: "llm-trace", Rate: 50, Sent: 1500, Acked: 1498, Failed: 2},
		Summary:   nodeprofile.AnalyseCPU(p, "/repo").Top(3),
	})
	out := b.String()
	lines := strings.Split(out, "\n")
	if !containsLine(lines, path) {
		t.Errorf("the profile path is not on a line of its own:\n%s", out)
	}
	for _, want := range []string{
		"haven obs cpu: api lane, pid 102, stack feat-x (the same process serves workers)",
		"cpu       busy 73.3 %   gc 6.7 %   program 6.7 %   idle 26.7 %",
		"memory    rss 812 MB   heap used 410 MB of 520 MB",
		"load      telemetry llm-trace at 50 batches/s: sent 1500, acked 1498, failed 2",
		"inspector opened with SIGUSR1 on :51234, closed after",
		"next: change the code, run haven obs cpu api again, then haven obs compare api",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("report lacks %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "\x1b[") {
		t.Error("report carries terminal escape codes")
	}
}

func containsLine(lines []string, want string) bool {
	for _, l := range lines {
		if l == want {
			return true
		}
	}
	return false
}
