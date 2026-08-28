package providers

import (
	"os"
	"strings"
	"testing"
)

// The docs page carries the policy table between generated-block markers;
// this test regenerates it from paramPolicyTable and diffs, so the table
// in the code and the table customers read cannot drift apart. To update
// the docs after a table change, paste the output of
// go test -run TestPrintParamTable -v between the markers.
func TestParamPolicyDocsInSync(t *testing.T) {
	raw, err := os.ReadFile("../../../../docs/ai-gateway/parameter-mapping.mdx")
	if err != nil {
		t.Fatalf("docs page missing: %v", err)
	}
	page := string(raw)
	begin := "{/* param-table:begin generated from paramPolicyTable, kept in sync by TestParamPolicyDocsInSync */}"
	end := "{/* param-table:end */}"
	i := strings.Index(page, begin)
	j := strings.Index(page, end)
	if i < 0 || j < 0 || j < i {
		t.Fatal("param-table markers missing from docs/ai-gateway/parameter-mapping.mdx")
	}
	docTable := strings.TrimSpace(page[i+len(begin) : j])
	want := strings.TrimSpace(renderParamPolicyTable())
	if docTable != want {
		t.Fatalf("docs table drifted from paramPolicyTable.\nRegenerate with: go test ./services/aigateway/adapters/providers -run TestPrintParamTable -v\n\nwant:\n%s\n\ngot:\n%s", want, docTable)
	}

	codexBegin := "{/* codex-param-table:begin generated from codexParamPolicyTable, kept in sync by TestParamPolicyDocsInSync */}"
	codexEnd := "{/* codex-param-table:end */}"
	ci := strings.Index(page, codexBegin)
	cj := strings.Index(page, codexEnd)
	if ci < 0 || cj < 0 || cj < ci {
		t.Fatal("codex-param-table markers missing from docs/ai-gateway/parameter-mapping.mdx")
	}
	codexDocTable := strings.TrimSpace(page[ci+len(codexBegin) : cj])
	codexWant := strings.TrimSpace(renderCodexParamPolicyTable())
	if codexDocTable != codexWant {
		t.Fatalf("docs table drifted from codexParamPolicyTable.\nRegenerate with: go test ./services/aigateway/adapters/providers -run TestPrintParamTable -v\n\nwant:\n%s\n\ngot:\n%s", codexWant, codexDocTable)
	}
}

// TestPrintParamTable is the generator: go test -run TestPrintParamTable -v
// prints the canonical table for pasting into the docs page.
func TestPrintParamTable(t *testing.T) {
	if testing.Verbose() {
		t.Log("\n" + renderParamPolicyTable())
		t.Log("\n" + renderCodexParamPolicyTable())
	}
}
