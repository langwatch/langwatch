package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/pkg/jwtverify"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The control plane and the data plane have to agree on the guardrail wire
// shape. They did not: this struct read "action" while the control plane sent
// "decision", so every verdict fell through to allow and no guardrail ever
// blocked anything. These tests pin both halves of the contract.

func TestGuardrailResponseUsesTheContractVerdictField(t *testing.T) {
	body := []byte(`{"decision":"block","reason":"PII detected: email","policies_triggered":["pii"]}`)

	var result guardrailCheckResponse
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result.Decision != "block" {
		t.Fatalf("decision = %q, want block", result.Decision)
	}
	if result.Reason != "PII detected: email" {
		t.Fatalf("reason = %q", result.Reason)
	}
	if len(result.PoliciesTriggered) != 1 || result.PoliciesTriggered[0] != "pii" {
		t.Fatalf("policies_triggered = %v", result.PoliciesTriggered)
	}
}

// A response carrying the old field name must not read as a valid verdict. If
// this ever passes, the two sides have drifted apart again.
func TestGuardrailResponseIgnoresTheOldActionField(t *testing.T) {
	var result guardrailCheckResponse
	if err := json.Unmarshal([]byte(`{"action":"block","message":"nope"}`), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result.Decision != "" {
		t.Fatalf("decision = %q, want empty so the caller treats it as a mismatch", result.Decision)
	}
}

func TestGuardrailRequestUsesTheContractFieldNames(t *testing.T) {
	packed, err := contentFor("request", []byte(`{"messages":[{"role":"user","content":"hi"}]}`))
	if err != nil {
		t.Fatalf("contentFor: %v", err)
	}
	body, err := json.Marshal(guardrailCheckRequest{
		VirtualKeyID: "vk_1",
		ProjectID:    "proj_1",
		Direction:    "request",
		Content:      packed,
		GuardrailIDs: []string{"guard_1"},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var wire map[string]any
	if err := json.Unmarshal(body, &wire); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, field := range []string{"vk_id", "project_id", "direction", "content", "guardrail_ids"} {
		if _, ok := wire[field]; !ok {
			t.Fatalf("request is missing contract field %q: %s", field, body)
		}
	}
	content, ok := wire["content"].(map[string]any)
	if !ok {
		t.Fatalf("content is not an object: %s", body)
	}
	if _, ok := content["messages"]; !ok {
		t.Fatalf("request-direction content must carry messages: %s", body)
	}
}

func TestContentForPacksEachDirectionUnderItsOwnKey(t *testing.T) {
	mustPack := func(t *testing.T, direction string, payload []byte) guardrailCheckContent {
		t.Helper()
		got, err := contentFor(direction, payload)
		if err != nil {
			t.Fatalf("contentFor(%q): %v", direction, err)
		}
		return got
	}

	t.Run("request extracts the messages array", func(t *testing.T) {
		got := mustPack(t, "request", []byte(`{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`))
		if !strings.Contains(string(got.Messages), `"role":"user"`) {
			t.Fatalf("messages = %s", got.Messages)
		}
		if got.Output != "" || got.Chunk != "" {
			t.Fatalf("request direction must not set output or chunk: %+v", got)
		}
	})

	// A guardrail written to catch a dangerous tool definition has to be able
	// to see one. The control plane scores content.tools and content.mcps, so
	// a data plane that forwarded only the prose would let such a policy pass
	// on an empty string.
	t.Run("request carries tools and mcps alongside the messages", func(t *testing.T) {
		got := mustPack(t, "request", []byte(`{
			"model":"gpt-5-mini",
			"messages":[{"role":"user","content":"hi"}],
			"tools":[{"type":"function","function":{"name":"rm_rf"}}],
			"mcps":[{"server":"acme-internal"}]
		}`))
		if !strings.Contains(string(got.Messages), `"role":"user"`) {
			t.Fatalf("messages = %s", got.Messages)
		}
		if !strings.Contains(string(got.Tools), "rm_rf") {
			t.Fatalf("tools were dropped: %s", got.Tools)
		}
		if !strings.Contains(string(got.MCPs), "acme-internal") {
			t.Fatalf("mcps were dropped: %s", got.MCPs)
		}
	})

	t.Run("request omits tools and mcps when the caller sent none", func(t *testing.T) {
		got := mustPack(t, "request", []byte(`{"messages":[{"role":"user","content":"hi"}]}`))
		if len(got.Tools) != 0 || len(got.MCPs) != 0 {
			t.Fatalf("empty tools/mcps must stay absent from the wire: %+v", got)
		}
	})

	t.Run("response extracts the assistant text", func(t *testing.T) {
		got := mustPack(t, "response", []byte(`{"choices":[{"message":{"content":"the answer"}}]}`))
		if got.Output != "the answer" {
			t.Fatalf("output = %q", got.Output)
		}
	})

	t.Run("response falls back to the raw body when the shape is unknown", func(t *testing.T) {
		got := mustPack(t, "response", []byte(`{"unexpected":true}`))
		if got.Output != `{"unexpected":true}` {
			t.Fatalf("output = %q", got.Output)
		}
	})

	t.Run("stream chunk carries the chunk", func(t *testing.T) {
		got := mustPack(t, "stream_chunk", []byte("partial text"))
		if got.Chunk != "partial text" {
			t.Fatalf("chunk = %q", got.Chunk)
		}
	})

	// The storage vocabulary and typos must not be packed as chunks. Before
	// this, a catch-all default sent them under "chunk" and the control plane
	// scored an envelope it was never asked to score.
	for _, direction := range []string{"pre", "post", "requst", ""} {
		t.Run("rejects the unknown direction "+strconv.Quote(direction), func(t *testing.T) {
			if _, err := contentFor(direction, []byte("x")); err == nil {
				t.Fatalf("contentFor(%q) must fail rather than guess a direction", direction)
			}
		})
	}
}

// monorepoRoot and controlPlaneRoot locate the TypeScript side relative to this
// package. The control plane used to be one application package at a fixed path;
// the feature extraction deleted it and split its gateway half into
// <root>/packages/features/gateway. That is the second such move -- ADR-076 was
// the first -- and each one broke this file, which is why the layout is derived
// in exactly one function.
//
// The files these tests read now span several packages, so a source read is
// addressed from the repository root; controlPlaneRoot is only the witness that
// decides skip-versus-fail.
var (
	monorepoRoot     = filepath.Join("..", "..", "..", "..")
	controlPlaneRoot = controlPlaneRootFor(monorepoRoot)
)

// controlPlaneRootFor derives the control plane's location from a repo root.
// Both the package-level controlPlaneRoot and controlPlaneVerdict resolve the
// layout through here, so a future move cannot repoint one and leave the other
// stale -- which is the drift ADR-076 already caused once.
func controlPlaneRootFor(root string) string {
	return filepath.Join(root, "packages", "features", "gateway", "server")
}

// The two witnesses that decide skip-versus-fail. Neither is a bare directory:
// a directory is re-created by any stray file that lands under it, and one was.
// A misplaced test restored langwatch/src/server, which re-satisfied the old
// os.Stat(controlPlaneRoot, "src", "server") guard and turned a constant that
// had been stale and silently skipping since the ADR-076 move into five red
// tests on main. A witness has to be something only the real control plane can
// produce, so these are a named repo-root manifest and a package identity.
const (
	workspaceManifest   = "pnpm-workspace.yaml"
	controlPlanePackage = "@langwatch/gateway-server"
)

// readControlPlaneSource reads one control plane source file, or ends the test.
// The parts are repository-relative: the contract is stated across the gateway
// feature package, its contract package, the trace package and the enterprise
// governance package, and no shared prefix spans all four.
func readControlPlaneSource(t *testing.T, parts ...string) string {
	t.Helper()
	requireControlPlane(t)

	path := filepath.Join(append([]string{monorepoRoot}, parts...)...)
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("control plane source %s is missing or unreadable, which means the two sides have drifted: %v", path, err)
	}
	return string(source)
}

// controlPlaneStatus is what controlPlaneVerdict decided. The zero value is
// deliberately none of the three: an unset status is not a skip.
type controlPlaneStatus string

const (
	controlPlaneOK    controlPlaneStatus = "ok"
	controlPlaneSkip  controlPlaneStatus = "skip"
	controlPlaneFatal controlPlaneStatus = "fatal"
)

// controlPlaneVerdict decides whether there is a control plane to compare
// against under root. It is a pure decision -- it reads the filesystem and
// returns, touching no *testing.T -- so every branch is driven by t.TempDir()
// fixtures in TestControlPlaneVerdictDecidesEachWitnessCombination instead of by
// whatever checkout CI happens to run in. Keep it that way: a guard whose
// branches are only ever exercised by the ambient checkout is the trap this file
// exists to close.
//
// Skipping is reserved for a checkout that carries no TypeScript side at all --
// a vendored or split Go build -- and requires BOTH witnesses to be absent: the
// pnpm workspace manifest at the repo root, and the control plane's own package
// manifest under controlPlaneRootFor(root). Either one alone is enough to run.
//
// THE AMBIGUOUS CASE FAILS, IT DOES NOT SKIP. A workspace present without the
// control plane under it -- exactly the shape of the ADR-076 rename -- is a hard
// failure naming the stale constant. So is a manifest that is present but
// unreadable, malformed, or naming another package: something is there, so the
// "no TypeScript side at all" premise for skipping is false, and the only honest
// verdicts left are run or fail. That direction is deliberate: a false red costs
// one path edit, while a false green costs an unenforced cross-language contract
// that nobody is watching, which is the failure this file exists to make loud.
// Do not relax any of this into a skip.
func controlPlaneVerdict(root string) (controlPlaneStatus, string) {
	cpRoot := controlPlaneRootFor(root)
	manifestPath := filepath.Join(cpRoot, "package.json")

	data, readErr := os.ReadFile(manifestPath)
	switch {
	case readErr == nil:
		// Parsed rather than pattern-matched so that reformatting the
		// manifest cannot read as a missing control plane.
		var manifest struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(data, &manifest); err != nil {
			return controlPlaneFatal, fmt.Sprintf(
				"%s is present but is not valid JSON, so the control plane cannot be identified: %v. "+
					"An unparseable manifest is drift, not a checkout without a TypeScript side.",
				manifestPath, err)
		}
		if manifest.Name != controlPlanePackage {
			return controlPlaneFatal, fmt.Sprintf(
				"%s names package %q, want %q: controlPlaneRoot points at some other workspace package. Repoint controlPlaneRoot.",
				manifestPath, manifest.Name, controlPlanePackage)
		}
		return controlPlaneOK, ""

	case !errors.Is(readErr, fs.ErrNotExist):
		// Something occupies the path but will not open. An unreadable
		// witness is not an absent one.
		return controlPlaneFatal, fmt.Sprintf(
			"%s exists but could not be read, so the control plane cannot be identified: %v",
			manifestPath, readErr)
	}

	workspacePath := filepath.Join(root, workspaceManifest)
	_, statErr := os.Stat(workspacePath)
	switch {
	case statErr == nil:
		return controlPlaneFatal, fmt.Sprintf(
			"this checkout carries the monorepo (%s is at the repo root) but %s holds no %s package manifest: "+
				"the control plane moved and controlPlaneRoot did not move with it. Repoint controlPlaneRoot.",
			workspaceManifest, cpRoot, controlPlanePackage)

	case !errors.Is(statErr, fs.ErrNotExist):
		// Exactly as strict as the manifest witness above. Anything other
		// than "not there" leaves the no-TypeScript-side premise unproven.
		return controlPlaneFatal, fmt.Sprintf(
			"%s exists but could not be read, so this checkout cannot be shown to carry no TypeScript side: %v. "+
				"An unreadable witness is not an absent one.",
			workspacePath, statErr)
	}

	return controlPlaneSkip, fmt.Sprintf(
		"no TypeScript control plane in this checkout: no %s at the repo root and no %s package manifest at %s",
		workspaceManifest, controlPlanePackage, cpRoot)
}

// controlPlaneReporter is the slice of *testing.T the dispatch needs, so the
// verdict-to-action mapping can be driven by a recorder. Mapping fatal onto Skip
// would resurrect exactly the silent non-enforcement this file exists to
// prevent, and nothing in a green CI run would show it.
type controlPlaneReporter interface {
	Helper()
	Skip(args ...any)
	Fatal(args ...any)
}

// requireControlPlane ends the calling test unless there is a control plane to
// compare against.
func requireControlPlane(t *testing.T) {
	t.Helper()
	dispatchControlPlaneVerdict(t, monorepoRoot)
}

// dispatchControlPlaneVerdict turns a verdict into an action. The one thing it
// must never do is let an unrecognized verdict fall through to a skip, so the
// default fails; it is unreachable while controlPlaneStatus has three values and
// is here for the edit that adds a fourth.
func dispatchControlPlaneVerdict(r controlPlaneReporter, root string) {
	r.Helper()
	switch status, reason := controlPlaneVerdict(root); status {
	case controlPlaneOK:
		return
	case controlPlaneSkip:
		r.Skip(reason)
	case controlPlaneFatal:
		r.Fatal(reason)
	default:
		r.Fatal(fmt.Sprintf("unrecognized control plane verdict %q", status))
	}
}

// The guard above is the same trap class as the bug this file documents: a
// branch that skips where it should fail costs nothing visible in a green CI
// run, and the last one survived eight days. Each case below builds a repo root
// under t.TempDir() and pins one verdict, so a later edit that widens the skip
// -- or that "simplifies" the switch, or repoints controlPlanePackage -- turns a
// test red instead of turning enforcement off.
func TestControlPlaneVerdictDecidesEachWitnessCombination(t *testing.T) {
	const (
		validManifest   = `{"name":"` + controlPlanePackage + `","version":"0.0.0"}`
		foreignManifest = `{"name":"@langwatch/some-other-package"}`
		malformed       = `{"name": `
	)

	cases := []struct {
		name               string
		fixture            controlPlaneFixture
		want               controlPlaneStatus
		wantReasonContains string
	}{
		{
			name:    "both witnesses present and valid",
			fixture: controlPlaneFixture{hasWorkspaceManifest: true, hasControlPlaneDir: true, manifest: validManifest},
			want:    controlPlaneOK,
		},
		{
			// A valid package manifest is sufficient to run without the
			// workspace manifest; a workspace-only checkout is fatal.
			name:    "the control plane is present without the workspace manifest",
			fixture: controlPlaneFixture{hasControlPlaneDir: true, manifest: validManifest},
			want:    controlPlaneOK,
		},
		{
			// The literal shape of the ADR-076 rename.
			name:               "the workspace is present and the control plane directory is gone",
			fixture:            controlPlaneFixture{hasWorkspaceManifest: true},
			want:               controlPlaneFatal,
			wantReasonContains: "Repoint controlPlaneRoot",
		},
		{
			// The old sentinel's exact defect: a bare directory, re-created by
			// any stray file, used to read as a live control plane.
			name:               "the workspace is present and the control plane path is an empty directory",
			fixture:            controlPlaneFixture{hasWorkspaceManifest: true, hasControlPlaneDir: true},
			want:               controlPlaneFatal,
			wantReasonContains: "Repoint controlPlaneRoot",
		},
		{
			// Same empty directory, no workspace: still must not be ok.
			name:               "the control plane path is an empty directory and nothing else",
			fixture:            controlPlaneFixture{hasControlPlaneDir: true},
			want:               controlPlaneSkip,
			wantReasonContains: "no TypeScript control plane",
		},
		{
			name:               "the manifest names another package",
			fixture:            controlPlaneFixture{hasWorkspaceManifest: true, hasControlPlaneDir: true, manifest: foreignManifest},
			want:               controlPlaneFatal,
			wantReasonContains: "@langwatch/some-other-package",
		},
		{
			// A wrong-named manifest is a present witness, so the absent-both
			// premise for skipping is false even without the workspace file.
			name:               "the manifest names another package and there is no workspace",
			fixture:            controlPlaneFixture{hasControlPlaneDir: true, manifest: foreignManifest},
			want:               controlPlaneFatal,
			wantReasonContains: "@langwatch/some-other-package",
		},
		{
			name:               "the manifest is malformed JSON",
			fixture:            controlPlaneFixture{hasWorkspaceManifest: true, hasControlPlaneDir: true, manifest: malformed},
			want:               controlPlaneFatal,
			wantReasonContains: "not valid JSON",
		},
		{
			name:               "the manifest is malformed JSON and there is no workspace",
			fixture:            controlPlaneFixture{hasControlPlaneDir: true, manifest: malformed},
			want:               controlPlaneFatal,
			wantReasonContains: "not valid JSON",
		},
		{
			name:               "the manifest is present but will not open",
			fixture:            controlPlaneFixture{hasControlPlaneDir: true, isManifestDirectory: true},
			want:               controlPlaneFatal,
			wantReasonContains: "could not be read",
		},
		{
			// The workspace witness has to be exactly as strict as the
			// manifest witness above: a witness that will not stat is present,
			// not absent, so the both-absent premise for skipping is false.
			name:               "the workspace manifest is present but will not stat",
			fixture:            controlPlaneFixture{hasUnreadableWorkspaceManifest: true},
			want:               controlPlaneFatal,
			wantReasonContains: "An unreadable witness is not an absent one",
		},
		{
			name:               "neither witness is present",
			fixture:            controlPlaneFixture{},
			want:               controlPlaneSkip,
			wantReasonContains: "no TypeScript control plane",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := tc.fixture.build(t)

			got, reason := controlPlaneVerdict(root)
			if got != tc.want {
				t.Fatalf("controlPlaneVerdict = %q (%s), want %q", got, reason, tc.want)
			}
			if tc.want == controlPlaneOK {
				return
			}
			// A skip or a failure nobody can act on is how the stale
			// constant went unnoticed, so the reason is part of the contract.
			if reason == "" {
				t.Fatalf("verdict %q carries no reason", got)
			}
			if !strings.Contains(reason, tc.wantReasonContains) {
				t.Fatalf("reason %q does not mention %q", reason, tc.wantReasonContains)
			}
		})
	}
}

// controlPlaneFixture describes which witnesses a temp repo root carries. The
// zero value is a checkout with no TypeScript side at all.
type controlPlaneFixture struct {
	hasWorkspaceManifest           bool   // pnpm-workspace.yaml at the repo root
	hasUnreadableWorkspaceManifest bool   // pnpm-workspace.yaml exists but will not stat
	hasControlPlaneDir             bool   // controlPlaneRootFor(root) exists, possibly empty
	manifest                       string // written to controlPlaneRootFor(root)/package.json when set
	isManifestDirectory            bool   // that package.json exists but cannot be read
}

// build materializes the fixture under t.TempDir() and returns the repo root.
func (f controlPlaneFixture) build(t *testing.T) string {
	t.Helper()

	root := t.TempDir()
	if f.hasWorkspaceManifest {
		writeControlPlaneFile(t, filepath.Join(root, workspaceManifest), "packages:\n  - \"packages/**\"\n")
	}
	if f.hasUnreadableWorkspaceManifest {
		// A symlink pointing at itself stats as ELOOP rather than ENOENT,
		// which is the cheapest deterministic unreadable witness -- and like
		// the directory below, it holds when the suite runs as root.
		loop := filepath.Join(root, workspaceManifest)
		if err := os.Symlink(loop, loop); err != nil {
			t.Fatalf("symlink loop %s: %v", loop, err)
		}
	}

	cpRoot := controlPlaneRootFor(root)
	if f.hasControlPlaneDir || f.manifest != "" || f.isManifestDirectory {
		if err := os.MkdirAll(cpRoot, 0o750); err != nil {
			t.Fatalf("mkdir %s: %v", cpRoot, err)
		}
	}

	manifestPath := filepath.Join(cpRoot, "package.json")
	switch {
	case f.isManifestDirectory:
		// A directory opens but will not read, which is the cheapest
		// deterministic stand-in for an unreadable manifest -- unlike a
		// permission bit, it also holds when the suite runs as root.
		if err := os.MkdirAll(manifestPath, 0o750); err != nil {
			t.Fatalf("mkdir %s: %v", manifestPath, err)
		}
	case f.manifest != "":
		writeControlPlaneFile(t, manifestPath, f.manifest)
	}
	return root
}

func writeControlPlaneFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// controlPlaneRecorder captures what the dispatch did without ending a real
// test. It does not reproduce t.Fatal's runtime.Goexit, which is harmless here:
// every branch of the dispatch returns immediately after reporting.
type controlPlaneRecorder struct {
	skipped bool
	failed  bool
	message string
}

func (r *controlPlaneRecorder) Helper() {}

func (r *controlPlaneRecorder) Skip(args ...any) {
	r.skipped = true
	r.message = fmt.Sprint(args...)
}

func (r *controlPlaneRecorder) Fatal(args ...any) {
	r.failed = true
	r.message = fmt.Sprint(args...)
}

// The verdict is only half the guard; the mapping from verdict to action is the
// half that can silently turn a hard failure into a skip. A recorder pins it.
func TestRequireControlPlaneDispatchesTheVerdictItWasGiven(t *testing.T) {
	cases := []struct {
		name        string
		fixture     controlPlaneFixture
		wantSkipped bool
		wantFailed  bool
	}{
		{
			name: "a present control plane lets the test run",
			fixture: controlPlaneFixture{
				hasWorkspaceManifest: true,
				hasControlPlaneDir:   true,
				manifest:             `{"name":"` + controlPlanePackage + `"}`,
			},
		},
		{
			name:       "an ambiguous checkout fails rather than skipping",
			fixture:    controlPlaneFixture{hasWorkspaceManifest: true},
			wantFailed: true,
		},
		{
			name:        "a checkout with no TypeScript side skips",
			fixture:     controlPlaneFixture{},
			wantSkipped: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := tc.fixture.build(t)

			var recorder controlPlaneRecorder
			dispatchControlPlaneVerdict(&recorder, root)

			if recorder.skipped != tc.wantSkipped {
				t.Errorf("skipped = %v, want %v (message: %s)", recorder.skipped, tc.wantSkipped, recorder.message)
			}
			if recorder.failed != tc.wantFailed {
				t.Errorf("failed = %v, want %v (message: %s)", recorder.failed, tc.wantFailed, recorder.message)
			}
		})
	}
}

// The control plane's Zod schema is the other half of the contract. Reading it
// here keeps a rename on the TypeScript side from silently breaking the gateway.
/** @scenario "the data plane and the control plane agree on the wire shape" */
func TestControlPlaneSchemaAgreesOnTheWireShape(t *testing.T) {
	text := readControlPlaneSource(t,
		"packages", "features", "gateway", "server", "src", "transport", "api-rest",
		"gateway-internal.api.ts")

	start := strings.Index(text, "const guardrailCheckRequestSchema")
	if start < 0 {
		t.Fatal("guardrailCheckRequestSchema not found in the control plane route")
	}
	end := strings.Index(text[start:], "});")
	if end < 0 {
		t.Fatal("could not delimit guardrailCheckRequestSchema")
	}
	schema := text[start : start+end]

	for _, field := range []string{"vk_id", "project_id", "direction", "guardrail_ids", "content"} {
		if !strings.Contains(schema, field) {
			t.Errorf("control plane request schema is missing %q", field)
		}
	}
	if strings.Contains(schema, `"pre"`) || strings.Contains(schema, `"post"`) {
		t.Error("control plane request schema still accepts the storage enum values instead of the wire directions")
	}

	// The accepted directions live in one exported constant so both the route
	// and this test read the same source of truth. The schema used to inline
	// the storage enum instead, so every live gateway call failed validation.
	service := readControlPlaneSource(t,
		"packages", "features", "gateway", "server", "src", "services",
		"gateway-guardrail-evaluation.service.ts")
	for _, direction := range []string{"request", "response", "stream_chunk"} {
		if !strings.Contains(service, `"`+direction+`"`) {
			t.Errorf("control plane does not accept direction %q", direction)
		}
	}

	// Both sides must name the verdict field "decision" and agree on the values
	// it can carry. The Go struct read "action" once, which is absent from the
	// response, so every verdict fell through to allow.
	if !strings.Contains(service, "decision: GuardrailDecision") {
		t.Error("control plane verdict no longer names its field decision")
	}
	for _, decision := range controlPlaneDecisions(t, service) {
		verdict, err := verdictFor(guardrailCheckResponse{Decision: decision})
		if err != nil {
			t.Errorf("control plane can emit decision %q but the data plane rejects it: %v", decision, err)
			continue
		}
		if decision == "block" && verdict.Action != domain.GuardrailBlock {
			t.Errorf("decision block mapped to %v", verdict.Action)
		}
	}
	if _, err := verdictFor(guardrailCheckResponse{Decision: "approve"}); err == nil {
		t.Error("a decision the control plane cannot emit must be treated as drift, not allowed")
	}
}

// controlPlaneDecisions reads the GuardrailDecision union the control plane
// declares, so the values are never hardcoded twice.
func controlPlaneDecisions(t *testing.T, service string) []string {
	t.Helper()
	const marker = "export type GuardrailDecision ="
	start := strings.Index(service, marker)
	if start < 0 {
		t.Fatal("GuardrailDecision is no longer declared by the control plane")
	}
	end := strings.Index(service[start:], ";")
	if end < 0 {
		t.Fatal("could not delimit the GuardrailDecision union")
	}
	var decisions []string
	for _, part := range strings.Split(service[start+len(marker):start+end], "|") {
		decisions = append(decisions, strings.Trim(strings.TrimSpace(part), `"`))
	}
	if len(decisions) == 0 {
		t.Fatal("the GuardrailDecision union is empty")
	}
	return decisions
}

// The stream-chunk direction is the one that fails open by design, so a slow
// or unreachable policy service never stalls a stream a user is already
// reading. That behavior must not change. What must be visible is that the
// allow was a bypass and not a verdict: an operator watching enforcement
// cannot tell an outage from healthy traffic otherwise, which is the same
// class of silent non-enforcement as the stub this changeset replaced.
//
// Driven through the real client against a control plane that refuses the
// call, rather than asserting on a message string.
func TestEvaluateChunkFailsOpenVisibly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	signer, err := NewSigner("test-secret", "node-1")
	require.NoError(t, err)
	client := NewClient(ClientOptions{
		BaseURL:    srv.URL,
		Sign:       signer.Sign,
		Verifier:   jwtverify.NewJWTVerifier("jwt-secret", ""),
		HTTPClient: srv.Client(),
	})

	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	ctx, span := provider.Tracer("test").Start(context.Background(), "gateway.request")

	bundle := &domain.Bundle{Config: domain.BundleConfig{
		Guardrails: domain.GuardrailsConfig{
			StreamChunk: []domain.GuardrailEntry{{ID: "guard_1", Evaluator: "pii"}},
		},
	}}
	verdict, err := client.EvaluateChunk(ctx, bundle, &domain.Request{}, []byte("partial"))

	// The stream keeps flowing. This is the deliberate part.
	require.NoError(t, err, "a stream chunk must never stall on the policy service")
	require.Equal(t, domain.GuardrailAllow, verdict.Action)

	// And the bypass is now legible rather than inferred.
	require.True(t, verdict.FailedOpen, "an allow the gateway could not justify must say so")
	require.NotEmpty(t, verdict.FailOpenReason, "the bypass must carry why it happened")

	span.End()
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	var stamped string
	for _, attr := range spans[0].Attributes {
		if attr.Key == "langwatch.guardrail.stream_chunk_fail_open" {
			stamped = attr.Value.AsString()
		}
	}
	require.NotEmpty(t, stamped, "contract 7b requires the bypass on the span: %+v", spans[0].Attributes)
}

// A chunk the control plane actually cleared must not be reported as a bypass.
func TestEvaluateChunkGenuineAllowIsNotAFailOpen(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"decision":"allow","reason":null,"policies_triggered":[]}`))
	}))
	defer srv.Close()

	signer, err := NewSigner("test-secret", "node-1")
	require.NoError(t, err)
	client := NewClient(ClientOptions{
		BaseURL:    srv.URL,
		Sign:       signer.Sign,
		Verifier:   jwtverify.NewJWTVerifier("jwt-secret", ""),
		HTTPClient: srv.Client(),
	})

	verdict, err := client.EvaluateChunk(context.Background(), &domain.Bundle{}, &domain.Request{}, []byte("partial"))
	require.NoError(t, err)
	require.Equal(t, domain.GuardrailAllow, verdict.Action)
	require.False(t, verdict.FailedOpen, "a cleared chunk is not a bypass")
}
