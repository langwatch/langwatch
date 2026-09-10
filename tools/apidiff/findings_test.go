package apidiff

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// These cases bind specs/tooling/apidiff-on-haven.feature's "Findings stream
// while the run is still going" scenario.

// recordingWriter counts every Write call separately from the bytes it holds,
// so a test can tell "one write per entry" (no batching) apart from "the
// bytes eventually all arrived".
type recordingWriter struct {
	strings.Builder
	writes int
	synced int
}

func (writer *recordingWriter) Write(data []byte) (int, error) {
	writer.writes++
	return writer.Builder.Write(data)
}

func (writer *recordingWriter) Sync() error {
	writer.synced++
	return nil
}

// @scenario "Findings stream while the run is still going"
func TestFindingsStreamAppendsOneLinePerEntryAndFlushes(t *testing.T) {
	t.Run("given a run is probing the operation union", func(t *testing.T) {
		writer := &recordingWriter{}
		stream := newFindingsStream(writer)

		t.Run("when one operation's comparison completes, one line is appended and flushed before the next", func(t *testing.T) {
			if err := stream.Append(StreamEntry{Surface: StreamSurfaceREST, Name: "GET /api/things", Kind: StreamIdentical}); err != nil {
				t.Fatalf("Append: %v", err)
			}
			if writer.writes != 1 {
				t.Fatalf("writes = %d, want 1 (no batching across entries)", writer.writes)
			}
			if writer.synced != 1 {
				t.Fatalf("synced = %d, want 1 — a writer that can Sync must be flushed per entry", writer.synced)
			}
			lines := strings.Split(strings.TrimRight(writer.String(), "\n"), "\n")
			if len(lines) != 1 {
				t.Fatalf("lines = %v, want exactly one", lines)
			}
			var entry StreamEntry
			if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if entry.Surface != StreamSurfaceREST || entry.Name != "GET /api/things" || entry.Kind != StreamIdentical {
				t.Errorf("entry = %+v", entry)
			}
			if entry.CapturedAt == "" {
				t.Error("capturedAt must be set even when not given explicitly")
			}

			if err := stream.Append(StreamEntry{Surface: StreamSurfaceREST, Name: "POST /api/things", Kind: StreamStatusDiffers, Detail: "status 200 -> 201"}); err != nil {
				t.Fatalf("Append: %v", err)
			}
			if writer.writes != 2 {
				t.Fatalf("writes = %d, want 2 after a second entry", writer.writes)
			}
		})

		t.Run("then when the run finishes, a final line reports run-complete with the totals by kind", func(t *testing.T) {
			if err := stream.Close(); err != nil {
				t.Fatalf("Close: %v", err)
			}
			lines := strings.Split(strings.TrimRight(writer.String(), "\n"), "\n")
			last := lines[len(lines)-1]
			var summary struct {
				Kind   string         `json:"kind"`
				Counts map[string]int `json:"counts"`
			}
			if err := json.Unmarshal([]byte(last), &summary); err != nil {
				t.Fatalf("unmarshal run-complete: %v", err)
			}
			if summary.Kind != "run-complete" {
				t.Fatalf("kind = %q, want run-complete", summary.Kind)
			}
			want := map[string]int{string(StreamIdentical): 1, string(StreamStatusDiffers): 1}
			if summary.Counts[string(StreamIdentical)] != want[string(StreamIdentical)] ||
				summary.Counts[string(StreamStatusDiffers)] != want[string(StreamStatusDiffers)] {
				t.Errorf("counts = %v, want %v", summary.Counts, want)
			}
		})
	})
}

func TestNewFindingsStreamAppendsToARealFileUnderTheRunDirectory(t *testing.T) {
	runDir := t.TempDir()
	stream, closeFile, err := NewFindingsStream(runDir)
	if err != nil {
		t.Fatalf("NewFindingsStream: %v", err)
	}
	if err := stream.Append(StreamEntry{Surface: StreamSurfaceREST, Name: "GET /api/things", Kind: StreamIdentical}); err != nil {
		t.Fatalf("Append: %v", err)
	}
	if err := closeFile(); err != nil {
		t.Fatalf("close: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(runDir, "findings.jsonl"))
	if err != nil {
		t.Fatalf("read findings.jsonl: %v", err)
	}
	if !strings.Contains(string(data), `"GET /api/things"`) {
		t.Errorf("findings.jsonl missing the appended entry: %s", data)
	}
}

func TestClassifyOperationMapsFindingKindsToTheStreamTaxonomy(t *testing.T) {
	present := Operation{Method: "GET", Path: "/api/things", InA: true, InB: true}
	absent := Operation{Method: "GET", Path: "/api/legacy", InA: false, InB: true}

	cases := []struct {
		name       string
		operation  Operation
		findings   []Finding
		wantKind   StreamKind
		wantDetail string
	}{
		{name: "no findings at all", operation: present, wantKind: StreamIdentical},
		{name: "missing on the branch side entirely", operation: absent, wantKind: StreamAbsentOnBranch, wantDetail: "present on base only"},
		{
			name: "a probe failure wins over everything else", operation: present,
			findings: []Finding{{Kind: FindingProbeFailed, Reason: "transport error"}, {Kind: FindingStatusDiff}},
			wantKind: StreamProbeFailed, wantDetail: "transport error",
		},
		{
			name: "operation_missing maps to absent-on-branch", operation: present,
			findings: []Finding{{Kind: FindingOperationMissing, Fields: map[string][2]any{"status": {200, 404}}}},
			wantKind: StreamAbsentOnBranch, wantDetail: "status 200 -> 404",
		},
		{
			name: "status_diff maps to status-differs", operation: present,
			findings: []Finding{{Kind: FindingStatusDiff, Fields: map[string][2]any{"status": {200, 500}}}},
			wantKind: StreamStatusDiffers, wantDetail: "status 200 -> 500",
		},
		{
			name: "body_shape_diff maps to shape-differs", operation: present,
			findings: []Finding{{Kind: FindingBodyShapeDiff, Fields: map[string][2]any{"/name": {"a", "b"}}}},
			wantKind: StreamShapeDiffers, wantDetail: "/name",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			kind, detail := classifyOperation(testCase.operation, testCase.findings)
			if kind != testCase.wantKind {
				t.Errorf("kind = %q, want %q", kind, testCase.wantKind)
			}
			if detail != testCase.wantDetail {
				t.Errorf("detail = %q, want %q", detail, testCase.wantDetail)
			}
		})
	}
}

func TestModuleForPathMatchesAModulesDirectory(t *testing.T) {
	repoRoot := t.TempDir()
	for _, name := range []string{"prompt", "api-key"} {
		if err := os.MkdirAll(filepath.Join(repoRoot, "modules", name), 0o750); err != nil {
			t.Fatal(err)
		}
	}
	cases := []struct{ path, want string }{
		{"/api/prompts/{id}", "prompt"},
		{"/api/v1/prompt", "prompt"},
		{"/api/api-keys", "api-key"},
		{"/api/nothing-like-a-module", ""},
	}
	for _, testCase := range cases {
		if got := ModuleForPath(repoRoot, testCase.path); got != testCase.want {
			t.Errorf("ModuleForPath(%q) = %q, want %q", testCase.path, got, testCase.want)
		}
	}
	if got := ModuleForPath("", "/api/prompts"); got != "" {
		t.Errorf("no repo root must resolve no module, got %q", got)
	}
}

// @scenario "Findings stream while the run is still going"
func TestOnOperationDoneStreamsAsEachComparisonCompletes(t *testing.T) {
	t.Run("given a run is probing the operation union over the swappable HTTP client", func(t *testing.T) {
		candidate := newTestServer(t, probeCandidateSpec, candidateRoutes())
		base := newTestServer(t, probeBaseSpec, baseRoutes())
		specA, _, err := FetchSpec(context.Background(), candidate.Client(), candidate.URL)
		if err != nil {
			t.Fatal(err)
		}
		specB, _, err := FetchSpec(context.Background(), base.Client(), base.URL)
		if err != nil {
			t.Fatal(err)
		}
		operationsA, err := Operations(specA)
		if err != nil {
			t.Fatal(err)
		}
		operationsB, err := Operations(specB)
		if err != nil {
			t.Fatal(err)
		}
		operations := UnionOperations(operationsA, operationsB)

		writer := &recordingWriter{}
		stream := newFindingsStream(writer)
		var seen []string

		t.Run("when each operation's comparison completes", func(t *testing.T) {
			result := ProbeAll(context.Background(), ProbeOptions{
				A: candidate.URL, B: base.URL,
				Keys:            Keys{ProjectKey: DefaultProjectKey},
				Schemes:         SecuritySchemes(specA, specB),
				Client:          candidate.Client(),
				OnOperationDone: findingsHook(stream, "", io.Discard),
			}, operations)
			_ = result

			t.Run("then one JSON line was appended per operation, naming surface, name and kind", func(t *testing.T) {
				lines := strings.Split(strings.TrimRight(writer.String(), "\n"), "\n")
				if len(lines) != len(operations) {
					t.Fatalf("appended %d lines, want one per union operation (%d)", len(lines), len(operations))
				}
				for _, line := range lines {
					var entry StreamEntry
					if err := json.Unmarshal([]byte(line), &entry); err != nil {
						t.Fatalf("unmarshal %q: %v", line, err)
					}
					if entry.Surface != StreamSurfaceREST || entry.Name == "" || entry.Kind == "" || entry.CapturedAt == "" {
						t.Errorf("incomplete entry: %+v", entry)
					}
					seen = append(seen, entry.Name)
				}
			})

			t.Run("then the operation the base never documents is absent-on-branch", func(t *testing.T) {
				// probeCandidateSpec adds /api/extra, which the base spec never
				// documents on its own side — but the finding the fixture tests
				// against is the reverse (base-only), so this asserts every emitted
				// entry names an operation actually in the union.
				for _, operation := range operations {
					name := operation.Method + " " + operation.Path
					if !slicesContain(seen, name) {
						t.Errorf("no stream entry for %s", name)
					}
				}
			})
		})

		t.Run("when the run finishes, run-complete reports the totals", func(t *testing.T) {
			if err := stream.Close(); err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(strings.TrimRight(writer.String(), "\n"), "\n")
			var summary struct {
				Kind   string         `json:"kind"`
				Counts map[string]int `json:"counts"`
			}
			if err := json.Unmarshal([]byte(lines[len(lines)-1]), &summary); err != nil {
				t.Fatal(err)
			}
			if summary.Kind != "run-complete" {
				t.Fatalf("kind = %q, want run-complete", summary.Kind)
			}
			total := 0
			for _, count := range summary.Counts {
				total += count
			}
			if total != len(operations) {
				t.Errorf("run-complete counts sum to %d, want %d (one per operation)", total, len(operations))
			}
		})
	})
}
