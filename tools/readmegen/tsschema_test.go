package readmegen

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestDeclarationPrintsShortSchemasAndLinksLongOnes(t *testing.T) {
	cases := map[string]struct{ schema, want string }{
		"object as interface": {`{"type":"object","properties":{"b":{"type":"integer"},"a":{"type":"string"}},"required":["b"]}`,
			"interface Body {\n  b: number;\n  a?: string;\n}\n"},
		"union as type":  {`{"anyOf":[{"type":"string"},{"type":"null"}]}`, "type Body = string | null;\n"},
		"const literal":  {`{"const":"ok"}`, "type Body = \"ok\";\n"},
		"tuple":          {`{"type":"array","prefixItems":[{"type":"string"},{"type":"boolean"}]}`, "type Body = [string, boolean];\n"},
		"quoted key":     {`{"type":"object","properties":{"x-id":{}},"required":["x-id"]}`, "interface Body {\n  \"x-id\": unknown;\n}\n"},
		"unconverted":    {`{"unconverted":"Transforms cannot be represented"}`, ""},
		"absent":         {``, ""},
		"empty object":   {`{"type":"object","properties":{},"additionalProperties":false}`, "interface Body {}\n"},
		"string to bool": {`{"type":"object","additionalProperties":{"type":"boolean"}}`, "type Body = Record<string, boolean>;\n"},
	}
	for name, c := range cases {
		if got := declaration("Body", json.RawMessage(c.schema)); got != c.want {
			t.Errorf("%s: got %q, want %q", name, got, c.want)
		}
	}
	fields := make([]string, 0, maxPrintedLines)
	for index := range maxPrintedLines {
		fields = append(fields, fmt.Sprintf(`"f%d":{"type":"string"}`, index))
	}
	long := `{"type":"object","properties":{` + strings.Join(fields, ",") + `}}`
	if got := declaration("Body", json.RawMessage(long)); got != "" {
		t.Errorf("a schema longer than %d lines printed inline:\n%s", maxPrintedLines, got)
	}
}

func TestANamedSchemaPrintsOncePerPage(t *testing.T) {
	ref := SchemaRef{Role: "output", Name: "itemSchema", At: Location{File: "modules/a/contract/src/a.ts", Line: 3}}
	raw := json.RawMessage(`{"type":"string"}`)
	index := schemaIndex{}.forPage()
	first, second := index.line("modules/a/process", ref, raw), index.line("modules/a/process", ref, raw)
	if !strings.Contains(first, "type Output = string;") {
		t.Errorf("first use did not print the schema: %q", first)
	}
	if second != "type Output = z.infer<typeof itemSchema>; // ../contract/src/a.ts:3\n" {
		t.Errorf("second use did not link to the source: %q", second)
	}
}

func TestPackageGroupsWaitForTheClosedList(t *testing.T) {
	core := workspacePackage{Dir: "packages/core", packageJSON: packageJSON{Name: "core"}}
	grouped := workspacePackage{Dir: "packages/api", packageJSON: packageJSON{Name: "api"}}
	grouped.LangWatch.Group = "Core vocabulary"
	nested := workspacePackage{Dir: "packages/core/fixtures"}
	packages := []workspacePackage{core, grouped, nested}
	if got := groupProblems(packages, nil); len(got) != 1 || !strings.Contains(got[0], `group "Core vocabulary" is not in the closed list`) {
		t.Errorf("with no ruled list, only the declared group is refused: %q", got)
	}
	if got := groupProblems(packages, []string{"Core vocabulary"}); len(got) != 1 || !strings.Contains(got[0], "packages/core/package.json: declare") {
		t.Errorf("with a ruled list, the package without a group is refused: %q", got)
	}
	ws := &workspace{packages: packages}
	g := &generator{ws: ws, kinds: map[string]string{}, groups: []string{"Core vocabulary"}}
	body := g.packageIndex("packages/README.md", "Packages", "packages/").Body
	if !strings.HasPrefix(body, "| Group ") || !strings.Contains(body, "| Core vocabulary | `api`") ||
		strings.Index(body, "`api`") > strings.Index(body, "`core`") {
		t.Errorf("the ruled list does not group the index:\n%s", body)
	}
}
