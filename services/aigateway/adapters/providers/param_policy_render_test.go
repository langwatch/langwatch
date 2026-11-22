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
	docTable := normalizeMarkdownTable(page[i+len(begin) : j])
	want := normalizeMarkdownTable(renderParamPolicyTable())
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
	codexDocTable := normalizeMarkdownTable(page[ci+len(codexBegin) : cj])
	codexWant := normalizeMarkdownTable(renderCodexParamPolicyTable())
	if codexDocTable != codexWant {
		t.Fatalf("docs table drifted from codexParamPolicyTable.\nRegenerate with: go test ./services/aigateway/adapters/providers -run TestPrintParamTable -v\n\nwant:\n%s\n\ngot:\n%s", codexWant, codexDocTable)
	}
}

// normalizeMarkdownTable trims each cell and collapses separator dashes, so
// the docs formatter padding the columns does not read as drift.
func normalizeMarkdownTable(table string) string {
	var rows []string
	for _, line := range strings.Split(strings.TrimSpace(table), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		cells := strings.Split(strings.Trim(line, "|"), "|")
		for k, cell := range cells {
			cell = strings.TrimSpace(cell)
			if cell != "" && strings.Trim(cell, "-:") == "" {
				cell = "---"
			}
			cells[k] = cell
		}
		rows = append(rows, "|"+strings.Join(cells, "|")+"|")
	}
	return strings.Join(rows, "\n")
}

// TestPrintParamTable is the generator: go test -run TestPrintParamTable -v
// prints the canonical table for pasting into the docs page.
func TestPrintParamTable(t *testing.T) {
	if testing.Verbose() {
		t.Log("\n" + renderParamPolicyTable())
		t.Log("\n" + renderCodexParamPolicyTable())
	}
}
