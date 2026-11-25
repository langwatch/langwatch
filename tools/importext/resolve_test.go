package importext

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFixture(t *testing.T, root, relative, contents string) string {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestResolveFindsEachCandidateInOrder(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "plain.ts", "")
	writeFixture(t, root, "component.tsx", "")
	writeFixture(t, root, "module.mts", "")
	writeFixture(t, root, "types.d.ts", "")
	writeFixture(t, root, "folder/index.ts", "")
	writeFixture(t, root, "widget/index.tsx", "")
	writeFixture(t, root, "emitted.ts", "")
	writeFixture(t, root, "exact.ts", "")

	cases := []struct{ specifier, want string }{
		{"./exact.ts", "./exact.ts"},
		{"./plain", "./plain.ts"},
		{"./component", "./component.tsx"},
		{"./module", "./module.mts"},
		{"./types", "./types.d.ts"},
		{"./folder", "./folder/index.ts"},
		{"./widget", "./widget/index.tsx"},
		{"./emitted.js", "./emitted.ts"},
		{"./missing", ""},
	}
	for _, testCase := range cases {
		if got := resolve(root, testCase.specifier); got != testCase.want {
			t.Errorf("resolve(%q) = %q, want %q", testCase.specifier, got, testCase.want)
		}
	}
}

func TestResolvePrefersTypeScriptOverIndexDirectory(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "both.ts", "")
	writeFixture(t, root, "both/index.ts", "")
	if got := resolve(root, "./both"); got != "./both.ts" {
		t.Errorf("resolve = %q, want ./both.ts", got)
	}
}

func TestClassifyPartitionsSpecifiers(t *testing.T) {
	cases := []struct {
		specifier string
		want      classification
	}{
		{"./local", classResolvable},
		{"../parent/thing", classResolvable},
		{"node:path", classIgnore},
		{"@langwatch/api", classIgnore},
		{"~/model/thing", classAlias},
		{"@/model/thing", classAlias},
		{"./data.json", classJSON},
		{"./styles.css", classIgnore},
		{"./icon.svg", classIgnore},
		{"./worker?worker", classIgnore},
	}
	for _, testCase := range cases {
		if got := classify(testCase.specifier); got != testCase.want {
			t.Errorf("classify(%q) = %v, want %v", testCase.specifier, got, testCase.want)
		}
	}
}

func TestParsePorcelainReadsBothSidesOfARename(t *testing.T) {
	dirty := parsePorcelain(" M apps/api/src/one.ts\x00R  apps/api/src/new.ts\x00apps/api/src/old.ts\x00")
	for _, path := range []string{"apps/api/src/one.ts", "apps/api/src/new.ts", "apps/api/src/old.ts"} {
		if !dirty[path] {
			t.Errorf("expected %q to be dirty", path)
		}
	}
}
