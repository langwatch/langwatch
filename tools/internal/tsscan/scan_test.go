package tsscan

import (
	"slices"
	"testing"
)

func specifiers(f *File) []string {
	var out []string
	for _, i := range f.Imports {
		out = append(out, i.Specifier)
	}
	return out
}

func TestScanSkipsWhatIsNotAModuleStatement(t *testing.T) {
	cases := []struct {
		name, src string
		jsx       bool
		imports   []string
		exports   []string
	}{
		{"strings and comments", "const a = \"import x from 'no'\";\n// import y from \"no\"\nimport z from \"yes\";\n", false, []string{"yes"}, nil},
		{"jsx text with an apostrophe", "const A = () => <p title={x}>Don't {y}</p>;\nexport const b = import(\"lazy\");\n", true, []string{"lazy"}, []string{"b"}},
		{"regex against divide", "const r = /import('no')/g; const d = a / b / c;\nexport { r };\n", false, nil, []string{"r"}},
		{"template substitution", "const t = `${await import(\"inner\")}`;\n", false, []string{"inner"}, nil},
		{"types are not calls", "type T = typeof import(\"a\");\nlet v: import(\"b\").C;\n", false, nil, nil},
		{"require method is not a call", "class S { async require(x) { return x; } }\nconst m = require(\"real\");\n", false, []string{"real"}, nil},
		{"declarators and patterns", "export const a = f<A, B>(), { b, c: [d, ...e] } = g, h = 1\nexport default function named() {}\n", false, nil, []string{"a", "b", "d", "e", "h", "named"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := Scan(c.src, c.jsx)
			if got := specifiers(f); !slices.Equal(got, c.imports) {
				t.Errorf("imports %q, want %q", got, c.imports)
			}
			if !slices.Equal(f.Exports, c.exports) {
				t.Errorf("exports %q, want %q", f.Exports, c.exports)
			}
		})
	}
}

func TestScanReadsClausesAndLines(t *testing.T) {
	f := Scan("import d, { a as b, type c } from \"x\";\n\nexport * as ns from \"y\";\nimport type { T } from \"z\";\n", false)
	want := []Reference{{Specifier: "x", Names: []string{"default", "a", "c"}}, {Specifier: "y", Every: true}, {Specifier: "z", Names: []string{"T"}}}
	if len(f.References) != len(want) {
		t.Fatalf("references %+v", f.References)
	}
	for i := range want {
		if f.References[i].Specifier != want[i].Specifier || f.References[i].Every != want[i].Every || !slices.Equal(f.References[i].Names, want[i].Names) {
			t.Errorf("reference %d = %+v, want %+v", i, f.References[i], want[i])
		}
	}
	if lines := []int{f.Imports[0].Line, f.Imports[1].Line, f.Imports[2].Line}; !slices.Equal(lines, []int{1, 3, 4}) || !f.Imports[2].TypeOnly {
		t.Errorf("lines %v, type-only %v", lines, f.Imports[2].TypeOnly)
	}
}

func TestDeclaratorsSkipStatementsInsideInitialisers(t *testing.T) {
	f := Scan("export const a = () => {\n  return 1;\n}, b = 2;\n", false)
	if want := []string{"a", "b"}; !slices.Equal(f.Exports, want) {
		t.Fatalf("exports %q, want %q", f.Exports, want)
	}
}
