package apidiff

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunUsageErrors(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := Run(nil, &stdout, &stderr); code != 2 {
		t.Fatalf("no args: exit = %d, want 2", code)
	}
	if code := Run([]string{"nonsense"}, &stdout, &stderr); code != 2 {
		t.Fatalf("unknown subcommand: exit = %d, want 2", code)
	}
}

func TestProbeRequiresBothURLs(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := Run([]string{"probe", "-a", "http://localhost:1"}, &stdout, &stderr); code != 2 {
		t.Fatalf("missing -b: exit = %d, want 2", code)
	}
}

func TestProbeRejectsBadMethod(t *testing.T) {
	var stdout, stderr bytes.Buffer
	args := []string{"probe", "-a", "http://localhost:1", "-b", "http://localhost:2", "-method", "frobnicate"}
	if code := Run(args, &stdout, &stderr); code != 2 {
		t.Fatalf("bad method: exit = %d, want 2", code)
	}
}

func TestProbeUnreachableIsOperationalError(t *testing.T) {
	var stdout, stderr bytes.Buffer
	// Nothing listens on these ports: spec fetch fails with exit 2.
	code := Run([]string{"probe", "-a", "http://127.0.0.1:1", "-b", "http://127.0.0.1:2", "-timeout", "1s"}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("unreachable: exit = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "fetch spec") {
		t.Fatalf("stderr must explain the failure:\n%s", stderr.String())
	}
}

func TestRepeatableExcludePrefixFlag(t *testing.T) {
	var values stringSlice
	if err := values.Set("/api/gateway"); err != nil {
		t.Fatal(err)
	}
	if err := values.Set("/api/internal"); err != nil {
		t.Fatal(err)
	}
	if len(values) != 2 || values[1] != "/api/internal" {
		t.Fatalf("stringSlice = %v", values)
	}
}

func TestNilWritersError(t *testing.T) {
	if code := Run([]string{"probe"}, nil, nil); code != 2 {
		t.Fatalf("nil writers: exit = %d, want 2", code)
	}
}

func TestLedgerPathDefaultsBesideTheReport(t *testing.T) {
	if got := ledgerPath(&probeFlags{reportFile: "/tmp/run/report.json"}); got != "/tmp/run/ledger.json" {
		t.Fatalf("ledgerPath = %q, want it beside the report", got)
	}
	if got := ledgerPath(&probeFlags{reportFile: "/tmp/run/report.json", ledgerFile: "/tmp/other.json"}); got != "/tmp/other.json" {
		t.Fatalf("-ledger must win: %q", got)
	}
	if got := ledgerPath(&probeFlags{}); got != "" {
		t.Fatalf("no report and no -ledger writes nothing, got %q", got)
	}
}

func TestLedgerBaselineMustExist(t *testing.T) {
	var stdout, stderr bytes.Buffer
	args := []string{"probe", "-a", "http://127.0.0.1:1", "-b", "http://127.0.0.1:2", "-ledger-baseline", "/nonexistent/ledger.json"}
	if code := Run(args, &stdout, &stderr); code != 2 {
		t.Fatalf("missing baseline: exit = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "ledger baseline") {
		t.Fatalf("stderr must name the baseline:\n%s", stderr.String())
	}
}
