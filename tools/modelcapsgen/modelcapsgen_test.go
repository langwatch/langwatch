package modelcapsgen

import (
	"bytes"
	"go/format"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeRegistry(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "llmModels.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return path
}

// @scenario "adding a conflicting model needs registry data and nothing else"
func TestReadCapabilities_PicksUpADeclaredConflictFromRegistryDataAlone(t *testing.T) {
	path := writeRegistry(t, `{"models":{
		"openai/brand-new-model":{
			"supportedParameters":["reasoning_effort","tools"],
			"reasoningConfig":{"supported":true,"canDisable":true,
				"toolsIncompatibleOn":["chat_completions"]}},
		"openai/quiet-model":{
			"supportedParameters":["reasoning_effort","tools"],
			"reasoningConfig":{"supported":true,"canDisable":true}},
		"openai/plain-model":{"supportedParameters":["tools"]}
	}}`)

	capabilities, err := ReadCapabilities(path)
	if err != nil {
		t.Fatalf("ReadCapabilities: %v", err)
	}
	if len(capabilities) != 1 {
		t.Fatalf("got %d capabilities; want only the model that declares a conflict: %+v",
			len(capabilities), capabilities)
	}
	got := capabilities[0]
	if got.ModelID != "openai/brand-new-model" || !got.CanDisable {
		t.Errorf("capability = %+v; want the new model with canDisable true", got)
	}

	renderedBytes, err := Render(capabilities)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	rendered := string(renderedBytes)
	if !strings.Contains(rendered, `"openai/brand-new-model"`) {
		t.Errorf("rendered table is missing the new model:\n%s", rendered)
	}
	if !strings.Contains(rendered, `conflictEndpoints: []string{"chat_completions"}`) {
		t.Errorf("rendered table is missing the endpoints:\n%s", rendered)
	}
	if strings.Contains(rendered, "quiet-model") {
		t.Errorf("a model with no declared conflict must not reach the table:\n%s", rendered)
	}
}

// Two runs over the same registry have to agree byte for byte, or the
// drift check fails at random and stops meaning anything.
func TestRender_IsDeterministicAndSorted(t *testing.T) {
	path := writeRegistry(t, `{"models":{
		"openai/zeta":{"reasoningConfig":{"supported":true,"canDisable":true,
			"toolsIncompatibleOn":["chat_completions","chat_completions"]}},
		"openai/alpha":{"reasoningConfig":{"supported":true,"canDisable":false,
			"toolsIncompatibleOn":["chat_completions"]}}
	}}`)

	first, err := ReadCapabilities(path)
	if err != nil {
		t.Fatalf("ReadCapabilities: %v", err)
	}
	second, err := ReadCapabilities(path)
	if err != nil {
		t.Fatalf("ReadCapabilities: %v", err)
	}
	firstOut, err := Render(first)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	secondOut, err := Render(second)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if !bytes.Equal(firstOut, secondOut) {
		t.Fatal("two runs over the same registry rendered different bytes")
	}
	if first[0].ModelID != "openai/alpha" {
		t.Errorf("capabilities are not sorted by model id: %+v", first)
	}
	// Duplicate endpoints collapse.
	if endpoints := first[1].ConflictEndpoints; len(endpoints) != 1 ||
		endpoints[0] != "chat_completions" {
		t.Errorf("endpoints = %v; want sorted and deduplicated", endpoints)
	}
}

// Render's output is the file gofmt runs over in CI, so it has to come out
// already formatted rather than merely parseable.
func TestRender_OutputIsGofmtClean(t *testing.T) {
	rendered, err := Render([]Capability{
		{ModelID: "openai/a", ConflictEndpoints: []string{"chat_completions"}, CanDisable: true},
		{ModelID: "openai/b", ConflictEndpoints: []string{"chat_completions"}, CanDisable: false},
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	formatted, err := format.Source(rendered)
	if err != nil {
		t.Fatalf("generated source does not parse: %v", err)
	}
	if !bytes.Equal(rendered, formatted) {
		t.Errorf("generated source is not gofmt-clean:\n%s", rendered)
	}
}

// The runtime rewrite is written to the chat-completions wire shape, so a
// declaration naming any other endpoint has to be refused at generation
// rather than emitted and silently mis-rewritten at dispatch. /v1/responses
// carries reasoning as a nested object and /v1/messages calls it
// `thinking`; either would be destroyed by the top-level `reasoning_effort`
// rewrite. This matters because /v1/responses is the named follow-up for
// the can't-disable case, so it is the declaration someone is most likely
// to reach for next.
func TestReadCapabilities_RefusesEndpointsTheRuntimeCannotHonor(t *testing.T) {
	for _, endpoint := range []string{"responses", "messages"} {
		registry := `{"models":{"openai/a":{"reasoningConfig":{"supported":true,
			"canDisable":true,"toolsIncompatibleOn":["` + endpoint + `"]}}}}`

		_, err := ReadCapabilities(writeRegistry(t, registry))

		if err == nil {
			t.Fatalf("%q was accepted; the runtime cannot honor it, so it must be refused", endpoint)
		}
		if !strings.Contains(err.Error(), "unknown endpoint") ||
			!strings.Contains(err.Error(), endpoint) {
			t.Errorf("error for %q = %v; want it to name the endpoint", endpoint, err)
		}
	}
}

func TestReadCapabilities_RejectsCurationMistakes(t *testing.T) {
	cases := map[string]struct {
		registry string
		wantErr  string
	}{
		"conflict declared on a model that does not reason": {
			registry: `{"models":{"openai/a":{"reasoningConfig":{"supported":false,
				"canDisable":true,"toolsIncompatibleOn":["chat_completions"]}}}}`,
			wantErr: "does not support reasoning",
		},
		"conflict declared on an endpoint we do not know": {
			registry: `{"models":{"openai/a":{"reasoningConfig":{"supported":true,
				"canDisable":true,"toolsIncompatibleOn":["chat_completion"]}}}}`,
			wantErr: "unknown endpoint",
		},
		"registry with no models at all": {
			registry: `{"models":{}}`,
			wantErr:  "holds no models",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := ReadCapabilities(writeRegistry(t, tc.registry))
			if err == nil {
				t.Fatalf("want an error containing %q, got none", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("error = %v; want it to mention %q", err, tc.wantErr)
			}
		})
	}
}

// The drift check is the only thing standing between a registry edit and
// a dispatch table that silently disagrees with it.
func TestRun_CheckFailsOnAStaleTableAndPassesOnAFreshOne(t *testing.T) {
	root := t.TempDir()
	registry := filepath.Join("data", "llmModels.json")
	out := filepath.Join("gen", "caps.generated.go")
	for _, dir := range []string{"data", "gen"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o750); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	body := `{"models":{"openai/a":{"reasoningConfig":{"supported":true,
		"canDisable":true,"toolsIncompatibleOn":["chat_completions"]}}}}`
	if err := os.WriteFile(filepath.Join(root, registry), []byte(body), 0o600); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, out), []byte("stale\n"), 0o600); err != nil {
		t.Fatalf("write stale output: %v", err)
	}

	args := []string{"-root", root, "-registry", registry, "-out", out}
	var stdout, stderr bytes.Buffer

	if code := Run(append(args, "-check"), &stdout, &stderr); code != 1 {
		t.Fatalf("-check on a stale table exited %d; want 1", code)
	}
	if !strings.Contains(stderr.String(), "make modelcapsgen") {
		t.Errorf("the failure must say how to fix it, got: %s", stderr.String())
	}

	stdout.Reset()
	stderr.Reset()
	if code := Run(args, &stdout, &stderr); code != 0 {
		t.Fatalf("generation exited %d; want 0 (%s)", code, stderr.String())
	}
	if code := Run(append(args, "-check"), &stdout, &stderr); code != 0 {
		t.Fatalf("-check after generation exited %d; want 0 (%s)", code, stderr.String())
	}
}
