package tsscan

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// TestDumpFacts is the differential harness's Go half: with TSSCAN_DUMP_IN
// naming a file list, it writes the same JSON lines as .claude/tmp's facts.ts.
func TestDumpFacts(t *testing.T) {
	in, out := os.Getenv("TSSCAN_DUMP_IN"), os.Getenv("TSSCAN_DUMP_OUT")
	if in == "" || out == "" {
		t.Skip("differential harness only")
	}
	list, err := os.ReadFile(in) //nolint:gosec // G703: the differential harness reads the file list its operator names
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(out) //nolint:gosec // G703: the harness writes where its operator asks
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	defer w.Flush()
	type ref struct {
		Specifier string   `json:"specifier"`
		Names     []string `json:"names"`
		Every     bool     `json:"every"`
	}
	type imp struct {
		Line       int    `json:"line"`
		Specifier  string `json:"specifier"`
		NonLiteral bool   `json:"nonLiteral"`
		TypeOnly   bool   `json:"typeOnly"`
		Dynamic    bool   `json:"dynamic"`
	}
	for _, path := range strings.Split(strings.TrimSpace(string(list)), "\n") {
		src, err := os.ReadFile(path) //nolint:gosec // G703: paths come from the operator's own file list
		if err != nil {
			t.Fatal(err)
		}
		facts := Scan(string(src), JSXFor(path))
		imports := []imp{}
		for _, i := range facts.Imports {
			imports = append(imports, imp(i))
		}
		refs := []ref{}
		for _, r := range facts.References {
			names := r.Names
			if names == nil {
				names = []string{}
			}
			refs = append(refs, ref{r.Specifier, names, r.Every})
		}
		exports := []string{}
		if strings.HasSuffix(path, ".ts") || strings.HasSuffix(path, ".tsx") {
			exports = append(exports, facts.Exports...)
		}
		line, _ := json.Marshal(map[string]any{"file": path, "imports": imports, "refs": refs, "exports": exports, "jsx": facts.RendersJSX})
		w.Write(line)
		w.WriteByte('\n')
	}
}
