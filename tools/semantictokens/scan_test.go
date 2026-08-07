package semantictokens

import (
	"strings"
	"testing"
)

func TestScanSource(t *testing.T) {
	t.Run("given a raw shade in a color prop", func(t *testing.T) {
		t.Run("when the prop is a plain attribute", func(t *testing.T) {
			got := ScanSource("a.tsx", `<Text color="gray.500">hi</Text>`)
			if len(got) != 1 {
				t.Fatalf("want 1 finding, got %d", len(got))
			}
			if got[0].Suggestion != "fg.subtle" {
				t.Errorf("want fg.subtle, got %q", got[0].Suggestion)
			}
		})

		t.Run("when the prop holds a ternary", func(t *testing.T) {
			got := ScanSource("a.tsx", `<Box bg={on ? "blue.500" : "transparent"} />`)
			if len(got) != 1 {
				t.Fatalf("want 1 finding, got %d", len(got))
			}
			if got[0].Suggestion != "blue.solid" {
				t.Errorf("want blue.solid, got %q", got[0].Suggestion)
			}
		})

		t.Run("when the shade sits in a pseudo-state object", func(t *testing.T) {
			got := ScanSource("a.tsx", `<Box _hover={{ bg: "gray.50" }} />`)
			if len(got) != 1 {
				t.Fatalf("want 1 finding, got %d", len(got))
			}
			if got[0].Suggestion != "bg.subtle" {
				t.Errorf("want bg.subtle, got %q", got[0].Suggestion)
			}
		})

		t.Run("when the prop is a directional border", func(t *testing.T) {
			got := ScanSource("a.tsx", `<Box borderLeftColor="gray.200" />`)
			if len(got) != 1 {
				t.Fatalf("want 1 finding, got %d", len(got))
			}
			if got[0].Suggestion != "border" {
				t.Errorf("want border, got %q", got[0].Suggestion)
			}
		})

		t.Run("reports the line it is on", func(t *testing.T) {
			got := ScanSource("a.tsx", "line one\nline two\n<Text color=\"red.700\" />")
			if len(got) != 1 {
				t.Fatalf("want 1 finding, got %d", len(got))
			}
			if got[0].Line != 3 {
				t.Errorf("want line 3, got %d", got[0].Line)
			}
		})
	})

	t.Run("given a semantic token", func(t *testing.T) {
		t.Run("reports nothing", func(t *testing.T) {
			src := `<Text color="fg.muted" bg="bg.panel" borderColor="border" />`
			if got := ScanSource("a.tsx", src); len(got) != 0 {
				t.Errorf("want no findings, got %v", got)
			}
		})
	})

	t.Run("given a raw shade outside a color prop", func(t *testing.T) {
		t.Run("reports nothing, because it is not a themed surface", func(t *testing.T) {
			src := `const legacyCtaColor = "orange.700";`
			if got := ScanSource("a.tsx", src); len(got) != 0 {
				t.Errorf("want no findings, got %v", got)
			}
		})
	})

	t.Run("given the same shade twice on one line", func(t *testing.T) {
		t.Run("reports it once per prop", func(t *testing.T) {
			got := ScanSource("a.tsx", `<Box bg={on ? "gray.50" : "gray.50"} />`)
			if len(got) != 1 {
				t.Errorf("want 1 finding, got %d: %v", len(got), got)
			}
		})
	})
}

func TestSuggest(t *testing.T) {
	t.Run("maps each shade to the token with the same light value", func(t *testing.T) {
		cases := []struct{ prop, raw, want string }{
			{"color", "gray.500", "fg.subtle"},
			{"color", "gray.600", "fg.muted"},
			{"color", "gray.900", "fg"},
			{"color", "red.700", "red.fg"},
			{"color", "red.500", "red.solid"},
			{"bg", "gray.50", "bg.subtle"},
			{"bg", "gray.100", "bg.muted"},
			{"bg", "gray.200", "bg.emphasized"},
			{"bg", "green.50", "green.subtle"},
			{"borderColor", "gray.200", "border"},
			{"borderColor", "gray.100", "border.muted"},
			{"fill", "blue.500", "blue.solid"},
		}
		for _, c := range cases {
			if got := Suggest(c.prop, c.raw); got != c.want {
				t.Errorf("Suggest(%q,%q) = %q, want %q", c.prop, c.raw, got, c.want)
			}
		}
	})

	t.Run("given a shade with no counterpart", func(t *testing.T) {
		t.Run("returns empty so the author chooses", func(t *testing.T) {
			if got := Suggest("bg", "gray.900"); got != "" {
				t.Errorf("want empty, got %q", got)
			}
		})
	})
}

func TestSuppressed(t *testing.T) {
	t.Run("given the ignore marker on the line above", func(t *testing.T) {
		t.Run("suppresses the finding", func(t *testing.T) {
			lines := strings.Split("// semantic-tokens-ignore: fixed banner\nbg=\"gray.500\"", "\n")
			if !suppressed(lines, 2) {
				t.Error("want suppressed")
			}
		})
	})

	t.Run("given no marker", func(t *testing.T) {
		t.Run("does not suppress", func(t *testing.T) {
			lines := []string{"// just a comment", `bg="gray.500"`}
			if suppressed(lines, 2) {
				t.Error("want not suppressed")
			}
		})
	})
}
