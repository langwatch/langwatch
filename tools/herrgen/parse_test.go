package herrgen_test

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/herrgen"
)

// tree writes a throwaway module whose files are keyed by repository-relative
// path, so a test reads as the Go it is parsing.
func tree(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	all := map[string]string{"go.mod": "module example.com/repo\n\ngo 1.26\n"}
	for path, source := range files {
		all[path] = source
	}
	for path, source := range all {
		full := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(source), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// herrPackage is the stub the fixtures import; only the shape matters, the
// parser never type-checks. Code is a defined string type here exactly as it is
// in pkg/herr, which is what lets a bare literal stand in for it at a call site.
const herrPackage = `package herr

import "context"

type Code string

type M map[string]any

type E struct {
	Code Code
	Meta M
}

func (e E) Error() string { return string(e.Code) }

func New(ctx context.Context, code Code, meta M, reasons ...error) E { return E{Code: code, Meta: meta} }

func NewLight(ctx context.Context, code Code, meta M, reasons ...error) E { return E{Code: code, Meta: meta} }

func RegisterStatus(code Code, status int) {}
`

func entryFor(t *testing.T, entries []herrgen.Entry, code string) herrgen.Entry {
	t.Helper()
	for _, entry := range entries {
		if entry.Code == code {
			return entry
		}
	}
	t.Fatalf("no entry for code %q in %d entries", code, len(entries))
	return herrgen.Entry{}
}

func TestParse(t *testing.T) {
	tests := []struct {
		name  string
		files map[string]string
		want  []herrgen.Entry
	}{
		{
			name: "a code inside a const block carries its own doc, not the block's",
			files: map[string]string{
				"services/nlpgo/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

// Error codes returned by the Go nlpgo service.
const (
	// ErrInvalidWorkflow signals a malformed workflow JSON.
	ErrInvalidWorkflow = herr.Code("invalid_workflow")
)

func RegisterStatuses() {
	herr.RegisterStatus(ErrInvalidWorkflow, http.StatusBadRequest)
}
`,
			},
			want: []herrgen.Entry{{
				Code:      "invalid_workflow",
				Status:    400,
				HasStatus: true,
				Declarations: []herrgen.Declaration{{
					Name:    "ErrInvalidWorkflow",
					Code:    "invalid_workflow",
					Doc:     "ErrInvalidWorkflow signals a malformed workflow JSON.\n",
					Source:  "services/nlpgo/domain/errors.go",
					Service: "nlpgo",
				}},
			}},
		},
		{
			name: "a standalone const carries the declaration's doc",
			files: map[string]string{
				"services/langyagent/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

// ErrAgentError marks a turn the agent itself reported as failed.
const ErrAgentError = herr.Code("agent_error")
`,
			},
			want: []herrgen.Entry{{
				Code: "agent_error",
				Declarations: []herrgen.Declaration{{
					Name:    "ErrAgentError",
					Code:    "agent_error",
					Doc:     "ErrAgentError marks a turn the agent itself reported as failed.\n",
					Source:  "services/langyagent/domain/errors.go",
					Service: "langyagent",
				}},
			}},
		},
		{
			name: "a code nothing registers gets no status",
			files: map[string]string{
				"services/aigateway/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const (
	ErrCircuitOpen = herr.Code("circuit_open")
)
`,
			},
			want: []herrgen.Entry{{
				Code: "circuit_open",
				Declarations: []herrgen.Declaration{{
					Name:    "ErrCircuitOpen",
					Code:    "circuit_open",
					Source:  "services/aigateway/domain/errors.go",
					Service: "aigateway",
				}},
			}},
		},
		{
			name: "a status registered from another package resolves through the import",
			files: map[string]string{
				"services/nlpgo/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

// ErrNotFound is returned by handlers that match no resource.
const ErrNotFound = herr.Code("not_found")
`,
				"services/nlpgo/adapters/httpapi/router.go": `package httpapi

import (
	"net/http"

	"example.com/repo/pkg/herr"
	"example.com/repo/services/nlpgo/domain"
)

func registerErrorStatuses() {
	herr.RegisterStatus(domain.ErrNotFound, http.StatusNotFound)
}
`,
			},
			want: []herrgen.Entry{{
				Code:      "not_found",
				Status:    404,
				HasStatus: true,
				Declarations: []herrgen.Declaration{{
					Name:    "ErrNotFound",
					Code:    "not_found",
					Doc:     "ErrNotFound is returned by handlers that match no resource.\n",
					Source:  "services/nlpgo/domain/errors.go",
					Service: "nlpgo",
				}},
			}},
		},
		{
			name: "a status registered as a plain integer resolves too",
			files: map[string]string{
				"pkg/rpc/decode.go": `package rpc

import "example.com/repo/pkg/herr"

const CodePayloadTooLarge = herr.Code("payload_too_large")

func RegisterStatuses() {
	herr.RegisterStatus(CodePayloadTooLarge, 413)
}
`,
			},
			want: []herrgen.Entry{{
				Code:      "payload_too_large",
				Status:    413,
				HasStatus: true,
				Declarations: []herrgen.Declaration{{
					Name:    "CodePayloadTooLarge",
					Code:    "payload_too_large",
					Source:  "pkg/rpc/decode.go",
					Service: "rpc",
				}},
			}},
		},
		{
			name: "two services sharing a code and a status make one entry",
			files: map[string]string{
				"services/nlpgo/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

// ErrBadRequest is the catch-all for shape errors.
const ErrBadRequest = herr.Code("bad_request")

func RegisterStatuses() {
	herr.RegisterStatus(ErrBadRequest, http.StatusBadRequest)
}
`,
				"services/aigateway/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

const ErrBadRequest = herr.Code("bad_request")

func registerErrorStatuses() {
	herr.RegisterStatus(ErrBadRequest, http.StatusBadRequest)
}
`,
			},
			// The doc-carrying declaration leads, so the entry keeps the one
			// sentence anybody wrote about the code.
			want: []herrgen.Entry{{
				Code:      "bad_request",
				Status:    400,
				HasStatus: true,
				Declarations: []herrgen.Declaration{
					{
						Name:    "ErrBadRequest",
						Code:    "bad_request",
						Doc:     "ErrBadRequest is the catch-all for shape errors.\n",
						Source:  "services/nlpgo/domain/errors.go",
						Service: "nlpgo",
					},
					{
						Name:    "ErrBadRequest",
						Code:    "bad_request",
						Source:  "services/aigateway/domain/errors.go",
						Service: "aigateway",
					},
				},
			}},
		},
		{
			name: "test files and testdata are not read",
			files: map[string]string{
				"services/nlpgo/domain/errors_test.go": `package domain

import "example.com/repo/pkg/herr"

const ErrFixture = herr.Code("fixture_only")
`,
				"services/nlpgo/testdata/errors.go": `package testdata

import "example.com/repo/pkg/herr"

const ErrGolden = herr.Code("golden_only")
`,
			},
			want: []herrgen.Entry{},
		},
		{
			name: "entries come back sorted by code",
			files: map[string]string{
				"services/aigateway/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const (
	ErrRateLimited = herr.Code("rate_limited")
	ErrNotFound    = herr.Code("not_found")
	ErrBadRequest  = herr.Code("bad_request")
)
`,
			},
			want: []herrgen.Entry{
				{Code: "bad_request", Declarations: []herrgen.Declaration{{Name: "ErrBadRequest", Code: "bad_request", Source: "services/aigateway/domain/errors.go", Service: "aigateway"}}},
				{Code: "not_found", Declarations: []herrgen.Declaration{{Name: "ErrNotFound", Code: "not_found", Source: "services/aigateway/domain/errors.go", Service: "aigateway"}}},
				{Code: "rate_limited", Declarations: []herrgen.Declaration{{Name: "ErrRateLimited", Code: "rate_limited", Source: "services/aigateway/domain/errors.go", Service: "aigateway"}}},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			files := map[string]string{"pkg/herr/herr.go": herrPackage}
			for path, source := range test.files {
				files[path] = source
			}

			got, _, err := herrgen.Parse(tree(t, files), io.Discard)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}
			if len(got) != len(test.want) {
				t.Fatalf("Parse() returned %d entries, want %d: %+v", len(got), len(test.want), got)
			}
			for i, want := range test.want {
				if got[i].Code != want.Code {
					t.Errorf("entry %d code = %q, want %q", i, got[i].Code, want.Code)
				}
				if got[i].Status != want.Status || got[i].HasStatus != want.HasStatus {
					t.Errorf("entry %q status = %d (registered %t), want %d (registered %t)",
						want.Code, got[i].Status, got[i].HasStatus, want.Status, want.HasStatus)
				}
				if len(got[i].Declarations) != len(want.Declarations) {
					t.Fatalf("entry %q has %d declarations, want %d: %+v",
						want.Code, len(got[i].Declarations), len(want.Declarations), got[i].Declarations)
				}
				for j, wantDeclaration := range want.Declarations {
					if got[i].Declarations[j] != wantDeclaration {
						t.Errorf("entry %q declaration %d = %+v, want %+v", want.Code, j, got[i].Declarations[j], wantDeclaration)
					}
				}
			}
		})
	}
}

func TestParseRejectsConflictingStatuses(t *testing.T) {
	// herr's registry is keyed by the code string, so the second registration
	// silently overwrites the first at init time. Generating either answer would
	// pin a lie in TypeScript.
	root := tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"services/nlpgo/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

const ErrNotFound = herr.Code("not_found")

func RegisterStatuses() {
	herr.RegisterStatus(ErrNotFound, http.StatusNotFound)
}
`,
		"services/aigateway/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

const ErrNotFound = herr.Code("not_found")

func registerErrorStatuses() {
	herr.RegisterStatus(ErrNotFound, http.StatusGone)
}
`,
	})

	_, _, err := herrgen.Parse(root, io.Discard)
	if err == nil {
		t.Fatal("Parse() error = nil, want a conflict")
	}
	for _, want := range []string{
		`code "not_found"`,
		"services/aigateway/domain/errors.go:12",
		"services/nlpgo/domain/errors.go:12",
		"404",
		"410",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("Parse() error = %q, want it to mention %q", err, want)
		}
	}
}

func TestParseAcceptsTheSameStatusTwice(t *testing.T) {
	// Generic codes (not_found, unauthorized, internal_error) legitimately live
	// in more than one service. Agreeing registrations are not a conflict.
	root := tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"services/nlpgo/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

const ErrUnauthorized = herr.Code("unauthorized")

func RegisterStatuses() {
	herr.RegisterStatus(ErrUnauthorized, http.StatusUnauthorized)
}
`,
		"services/langyagent/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

const ErrUnauthorized = herr.Code("unauthorized")

func RegisterStatuses() {
	herr.RegisterStatus(ErrUnauthorized, 401)
}
`,
	})

	entries, _, err := herrgen.Parse(root, io.Discard)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	entry := entryFor(t, entries, "unauthorized")
	if !entry.HasStatus || entry.Status != 401 {
		t.Errorf("unauthorized status = %d (registered %t), want 401 (registered true)", entry.Status, entry.HasStatus)
	}
	if len(entry.Declarations) != 2 {
		t.Errorf("unauthorized has %d declarations, want 2", len(entry.Declarations))
	}
}

func TestParseReadsTypedConstDeclarations(t *testing.T) {
	// `const X herr.Code = "x"` puts the conversion in the declared type rather
	// than around the literal. It is the same declaration to the compiler, and
	// missing it means the code ships with no customer-facing copy.
	root := tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"pkg/config/validate.go": `package config

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

// ConfigInvalid is the herr code for configuration validation failures.
const ConfigInvalid herr.Code = "config_invalid"

func RegisterStatuses() {
	herr.RegisterStatus(ConfigInvalid, http.StatusBadRequest)
}
`,
	})

	entries, _, err := herrgen.Parse(root, io.Discard)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	entry := entryFor(t, entries, "config_invalid")
	want := herrgen.Declaration{
		Name:    "ConfigInvalid",
		Code:    "config_invalid",
		Doc:     "ConfigInvalid is the herr code for configuration validation failures.\n",
		Source:  "pkg/config/validate.go",
		Service: "config",
	}
	if len(entry.Declarations) != 1 || entry.Declarations[0] != want {
		t.Errorf("config_invalid declarations = %+v, want [%+v]", entry.Declarations, want)
	}
	if !entry.HasStatus || entry.Status != 400 {
		t.Errorf("config_invalid status = %d (registered %t), want 400 (registered true)", entry.Status, entry.HasStatus)
	}
}

func TestParseReadsTypedConstsInsideABlock(t *testing.T) {
	// Only the specs that carry the type are codes; a plain string const in the
	// same block is not one.
	root := tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"services/nlpgo/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const (
	// ErrBusy is thrown while another run holds the workflow.
	ErrBusy herr.Code = "busy"
	DefaultQueue        = "runs"
)
`,
	})

	entries, _, err := herrgen.Parse(root, io.Discard)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(entries) != 1 || entries[0].Code != "busy" {
		t.Fatalf("Parse() = %+v, want exactly the busy entry", entries)
	}
	if entries[0].Declarations[0].Doc != "ErrBusy is thrown while another run holds the workflow.\n" {
		t.Errorf("busy doc = %q, want the const's own doc", entries[0].Declarations[0].Doc)
	}
}

func TestParseIgnoresATrailingLineComment(t *testing.T) {
	// A trailing comment is a note to the next Go reader — usually the status,
	// or a "// deprecated". Rendering it as the entry's JSDoc turned it into
	// "ErrBusy — 409", which reads as the code's definition and is not one.
	root := tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"services/nlpgo/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const ErrBusy = herr.Code("busy") // 409
`,
	})

	entries, _, err := herrgen.Parse(root, io.Discard)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if doc := entryFor(t, entries, "busy").Primary().Doc; doc != "" {
		t.Errorf("busy doc = %q, want none — a trailing comment is not a doc comment", doc)
	}
}

func TestParseRejectsAnUnmappedHTTPStatusConstant(t *testing.T) {
	// Skipping it would emit a status-less entry, which reads exactly like a
	// code nobody registered — a silent lie in the generated file.
	root := tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"services/nlpgo/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

const ErrTeapot = herr.Code("teapot")

func RegisterStatuses() {
	herr.RegisterStatus(ErrTeapot, http.StatusInventedByNobody)
}
`,
	})

	_, _, err := herrgen.Parse(root, io.Discard)
	if err == nil {
		t.Fatal("Parse() error = nil, want the unmapped status constant to fail the run")
	}
	for _, want := range []string{"StatusInventedByNobody", "services/nlpgo/domain/errors.go:12"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("Parse() error = %q, want it to mention %q", err, want)
		}
	}
}

func TestParseRejectsADotImportOfHerr(t *testing.T) {
	// A dot import erases the `herr.` qualifier every read below matches on, so
	// the file's codes would vanish from the generated output without a word.
	root := tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"services/nlpgo/domain/errors.go": `package domain

import . "example.com/repo/pkg/herr"

const ErrHidden = Code("hidden")
`,
	})

	_, _, err := herrgen.Parse(root, io.Discard)
	if err == nil {
		t.Fatal("Parse() error = nil, want the dot import to fail the run")
	}
	for _, want := range []string{"services/nlpgo/domain/errors.go", "dot-import"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("Parse() error = %q, want it to mention %q", err, want)
		}
	}
}

func TestParseSkipsUnparseableSnippetsWithAWarning(t *testing.T) {
	// The tree carries hand-written Go that is never compiled (documentation
	// snippets rendered into the product UI). One of those failing to parse must
	// not take the drift check down with it.
	root := tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"langwatch/src/features/onboarding/regions/observability/codegen/snippets/go/openai.snippet.go": `package main

func main() { this is not Go
`,
		"services/nlpgo/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const ErrBusy = herr.Code("busy")
`,
	})

	var warnings strings.Builder
	entries, _, err := herrgen.Parse(root, &warnings)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	entryFor(t, entries, "busy")
	if !strings.Contains(warnings.String(), "openai.snippet.go") {
		t.Errorf("warnings = %q, want the skipped file named", warnings.String())
	}
}

func TestParseFailsOnAnUnparseableServiceFile(t *testing.T) {
	// A service file failing to parse mid-refactor used to drop every code in it
	// and exit 0, committing a truncated artifact.
	root := tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"services/nlpgo/domain/errors.go": `package domain

const ErrBusy = herr.Code( this is not Go
`,
	})

	_, _, err := herrgen.Parse(root, io.Discard)
	if err == nil {
		t.Fatal("Parse() error = nil, want the unparseable service file to fail the run")
	}
	if !strings.Contains(err.Error(), "services/nlpgo/domain/errors.go") {
		t.Errorf("Parse() error = %q, want it to name the file", err)
	}
}

func TestParseReadsCodesOutsideAConstBlock(t *testing.T) {
	// Every one of these compiles and puts a code on the wire. Missing any of
	// them leaves a live code with no customer copy and the drift check green.
	tests := []struct {
		name   string
		source string
		code   string
		// declaredBy is the const name the entry should carry, empty when the
		// code has no const to name.
		declaredBy string
	}{
		{
			name: "a var sentinel, which is what herr.Code satisfying error invites",
			source: `package domain

import "example.com/repo/pkg/herr"

// ErrBusy is returned while another run holds the workflow.
var ErrBusy = herr.Code("busy")
`,
			code:       "busy",
			declaredBy: "ErrBusy",
		},
		{
			name: "a typed var",
			source: `package domain

import "example.com/repo/pkg/herr"

var ErrBusy herr.Code = "busy"
`,
			code:       "busy",
			declaredBy: "ErrBusy",
		},
		{
			name: "a conversion inside a map literal",
			source: `package domain

import "example.com/repo/pkg/herr"

var byKind = map[string]herr.Code{
	"workflow": herr.Code("busy"),
}
`,
			code: "busy",
		},
		{
			name: "a conversion inside a struct literal",
			source: `package domain

import "example.com/repo/pkg/herr"

type rule struct{ code herr.Code }

var busyRule = rule{code: herr.Code("busy")}
`,
			code: "busy",
		},
		{
			name: "a conversion in a function body",
			source: `package domain

import "example.com/repo/pkg/herr"

func codeFor() herr.Code {
	return herr.Code("busy")
}
`,
			code: "busy",
		},
		{
			name: "a const declared inside a function body",
			source: `package domain

import "example.com/repo/pkg/herr"

func codeFor() herr.Code {
	const ErrBusy = herr.Code("busy")
	return ErrBusy
}
`,
			code:       "busy",
			declaredBy: "ErrBusy",
		},
		{
			name: "a code assembled from adjacent literals",
			source: `package domain

import "example.com/repo/pkg/herr"

const ErrBusy = herr.Code("bu" + "sy")
`,
			code:       "busy",
			declaredBy: "ErrBusy",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := tree(t, map[string]string{
				"pkg/herr/herr.go":                herrPackage,
				"services/nlpgo/domain/errors.go": test.source,
			})

			entries, _, err := herrgen.Parse(root, io.Discard)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}
			entry := entryFor(t, entries, test.code)
			if got := entry.Primary().Name; got != test.declaredBy {
				t.Errorf("entry %q names const %q, want %q", test.code, got, test.declaredBy)
			}
			if got := entry.Primary().Source; got != "services/nlpgo/domain/errors.go" {
				t.Errorf("entry %q source = %q, want the declaring file", test.code, got)
			}
		})
	}
}

func TestParseRejectsACodeItCannotRead(t *testing.T) {
	// A code built from a const prefix is the one shape that must never be
	// passed over: the string exists at runtime, so the customer meets it, and
	// silence here is a code with no copy and a green drift check.
	tests := []struct {
		name   string
		source string
	}{
		{
			name: "a const prefix",
			source: `package domain

import "example.com/repo/pkg/herr"

const prefix = "workflow_"

const ErrBusy = herr.Code(prefix + "busy")
`,
		},
		{
			name: "a function call",
			source: `package domain

import "example.com/repo/pkg/herr"

func name() string { return "busy" }

var ErrBusy = herr.Code(name())
`,
		},
		{
			name: "a typed const built from a prefix",
			source: `package domain

import "example.com/repo/pkg/herr"

const prefix = "workflow_"

const ErrBusy herr.Code = prefix + "busy"
`,
		},
		{
			name: "a conversion in a function body",
			source: `package domain

import "example.com/repo/pkg/herr"

func codeFor(kind string) herr.Code {
	return herr.Code("workflow_" + kind)
}
`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := tree(t, map[string]string{
				"pkg/herr/herr.go":                herrPackage,
				"services/nlpgo/domain/errors.go": test.source,
			})

			_, _, err := herrgen.Parse(root, io.Discard)
			if err == nil {
				t.Fatal("Parse() error = nil, want the unreadable code to fail the run")
			}
			if !strings.Contains(err.Error(), "services/nlpgo/domain/errors.go") {
				t.Errorf("Parse() error = %q, want it to name the file and line", err)
			}
		})
	}
}

func TestParseReadsInlineStringCodes(t *testing.T) {
	// herr.Code is a defined string type, so a bare literal in a constructor
	// compiles with no conversion in sight and reaches the client identically.
	tests := []struct {
		name   string
		source string
	}{
		{
			name: "herr.New",
			source: `package httpmiddleware

import (
	"context"

	"example.com/repo/pkg/herr"
)

func fail(ctx context.Context) error {
	return herr.New(ctx, "internal_error", nil)
}
`,
		},
		{
			name: "herr.NewLight",
			source: `package httpmiddleware

import (
	"context"

	"example.com/repo/pkg/herr"
)

func fail(ctx context.Context) error {
	return herr.NewLight(ctx, "internal_error", nil)
}
`,
		},
		{
			name: "a herr.E literal",
			source: `package httpmiddleware

import "example.com/repo/pkg/herr"

var boom = herr.E{Code: "internal_error"}
`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := tree(t, map[string]string{
				"pkg/herr/herr.go":              herrPackage,
				"pkg/httpmiddleware/recover.go": test.source,
			})

			entries, _, err := herrgen.Parse(root, io.Discard)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}
			entry := entryFor(t, entries, "internal_error")
			if entry.Primary().Source != "pkg/httpmiddleware/recover.go" {
				t.Errorf("internal_error source = %q, want the call site", entry.Primary().Source)
			}
			if entry.Primary().Name != "" {
				t.Errorf("internal_error names const %q, want none — there is no const", entry.Primary().Name)
			}
		})
	}

	t.Run("a constructor given a const carries the const's doc, not a second entry", func(t *testing.T) {
		root := tree(t, map[string]string{
			"pkg/herr/herr.go": herrPackage,
			"services/nlpgo/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

// ErrBusy is returned while another run holds the workflow.
const ErrBusy = herr.Code("busy")
`,
			"services/nlpgo/app/run.go": `package app

import (
	"context"

	"example.com/repo/pkg/herr"
	"example.com/repo/services/nlpgo/domain"
)

func fail(ctx context.Context) error {
	return herr.New(ctx, domain.ErrBusy, nil)
}
`,
		})

		entries, _, err := herrgen.Parse(root, io.Discard)
		if err != nil {
			t.Fatalf("Parse() error = %v", err)
		}
		entry := entryFor(t, entries, "busy")
		if len(entry.Declarations) != 1 {
			t.Errorf("busy has %d declarations, want just the const: %+v", len(entry.Declarations), entry.Declarations)
		}
	})
}

func TestParseRejectsAStatusItCannotRead(t *testing.T) {
	// A registration is unmistakably a status registration, so a status herrgen
	// cannot read would emit a status-less entry — indistinguishable from a code
	// nobody registered.
	tests := []struct {
		name   string
		status string
	}{
		{name: "a local const", status: "statusBusy"},
		{name: "a call", status: "statusFor()"},
		{name: "a selector into another package", status: "codes.Busy"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := tree(t, map[string]string{
				"pkg/herr/herr.go": herrPackage,
				"services/nlpgo/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const statusBusy = 409

func statusFor() int { return 409 }

const ErrBusy = herr.Code("busy")

func RegisterStatuses() {
	herr.RegisterStatus(ErrBusy, ` + test.status + `)
}
`,
			})

			_, _, err := herrgen.Parse(root, io.Discard)
			if err == nil {
				t.Fatal("Parse() error = nil, want the unreadable status to fail the run")
			}
			if !strings.Contains(err.Error(), "services/nlpgo/domain/errors.go:12") {
				t.Errorf("Parse() error = %q, want it to name the registration", err)
			}
		})
	}
}

func TestParseIsDeterministicAcrossRuns(t *testing.T) {
	// The two renderer "stability" tests only feed a pre-sorted slice to a pure
	// function, so a dropped sort in group or groupNodeCodes would sail past
	// them. This runs the whole walk, whose map iteration is the actual risk.
	root := tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"services/nlpgo/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const (
	ErrBusy      = herr.Code("busy")
	ErrNotFound  = herr.Code("not_found")
	ErrForbidden = herr.Code("forbidden")
)
`,
		"services/aigateway/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const (
	ErrRateLimited = herr.Code("rate_limited")
	ErrNotFound    = herr.Code("not_found")
	ErrCircuitOpen = herr.Code("circuit_open")
)
`,
		"services/langyagent/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const (
	ErrAgentError = herr.Code("agent_error")
	ErrBusy       = herr.Code("busy")
	ErrSpawn      = herr.Code("worker_spawn_failed")
	ErrNotReady   = herr.Code("worker_not_ready")
	ErrNoFreeUID  = herr.Code("no_free_worker_uid")
)
`,
		"services/nlpgo/app/engine/engine.go": `package engine

type NodeError struct {
	Type    string
	Message string
}

var (
	_ = NodeError{Type: "http_error"}
	_ = NodeError{Type: "llm_error"}
	_ = NodeError{Type: "invalid_dataset"}
	_ = NodeError{Type: "engine_error"}
)
`,
		"services/nlpgo/app/engine/code.go": `package engine

var (
	_ = NodeError{Type: "code_runner_error"}
	_ = NodeError{Type: "http_error"}
	_ = NodeError{Type: "context_canceled"}
	_ = NodeError{Type: "invalid_condition"}
	_ = NodeError{Type: "code_block_timeout"}
	_ = NodeError{Type: "upstream_http_error"}
)
`,
	})

	entries, nodeCodes, err := herrgen.Parse(root, io.Discard)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(entries) < 8 || len(nodeCodes) < 8 {
		t.Fatalf("fixture is too small to catch an ordering bug: %d codes, %d node codes", len(entries), len(nodeCodes))
	}
	first := string(herrgen.Render(entries)) + string(herrgen.RenderNodeCodes(nodeCodes))

	for run := range 20 {
		gotEntries, gotNodeCodes, err := herrgen.Parse(root, io.Discard)
		if err != nil {
			t.Fatalf("Parse() error on run %d = %v", run, err)
		}
		got := string(herrgen.Render(gotEntries)) + string(herrgen.RenderNodeCodes(gotNodeCodes))
		if got != first {
			t.Fatalf("run %d generated different bytes:\n%s\n\nvs\n\n%s", run, first, got)
		}
	}
}

func TestParseFailsWithoutAGoModAtTheRoot(t *testing.T) {
	root := t.TempDir()
	// Named for what it asserts. It used to be called
	// TestParseSkipsDirectoriesOutsideAnyModule, which described a walk-level
	// skip that could never fire — `Parse` reads the root's go.mod first, so a
	// root without one never reaches the walk at all.
	if _, _, err := herrgen.Parse(root, io.Discard); err == nil {
		t.Fatal("Parse() error = nil, want a missing-go.mod failure")
	}
}
