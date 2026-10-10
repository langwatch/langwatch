package workerrun

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPercentilesAndDelta(t *testing.T) {
	got := percentiles([]time.Duration{4 * time.Second, time.Second, 2 * time.Second, 3 * time.Second})
	if got.P50Ms != 2000 || got.P95Ms != 4000 || got.MaxMs != 4000 {
		t.Fatalf("percentiles = %+v", got)
	}
	added, fixed := delta([]string{"a", "b"}, []string{"b", "c"})
	if len(added) != 1 || added[0] != "c" || len(fixed) != 1 || fixed[0] != "a" {
		t.Fatalf("delta = %v %v", added, fixed)
	}
}

func TestBucketTotalSumsOneSeries(t *testing.T) {
	if got := bucketTotal([]byte(`{"currentPeriod":[{"date":"x","0/metadata.trace_id/cardinality":3},{"date":"y","0/metadata.trace_id/cardinality":2}]}`)); got != 5 {
		t.Fatalf("bucketTotal = %d", got)
	}
}

func TestSignaturesAttributeAndStripIDs(t *testing.T) {
	lines := []string{
		`{"level":"error","name":"langwatch:worker","msg":"job 123 failed","tenantId":"project_ours"}`,
		`{"level":"error","name":"langwatch:worker","msg":"job 456 failed"}`,
		`{"level":"info","name":"langwatch:worker","msg":"fine"}`,
	}
	signatures := scanSignatures(lines, []string{"project_ours"})
	if len(signatures) != 1 || signatures[0].Count != 2 || !signatures[0].Ours {
		t.Fatalf("signatures = %+v", signatures)
	}
}

func TestLogWindowFollowsRotation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "api.log")
	write := func(name, body string) {
		if err := os.WriteFile(name, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(path, "old line\n")
	window := openLogWindow(path)
	write(path+".1", "old line\nlate line\n")
	write(path, "new\n")
	lines, err := window.read()
	if err != nil || len(lines) != 2 || lines[0] != "late line" || lines[1] != "new" {
		t.Fatalf("lines = %q, %v", lines, err)
	}
}
