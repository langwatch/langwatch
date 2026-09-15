package visualdiff

import (
	"os"
	"path/filepath"
	"testing"
)

// testCatalogue is a small fixture standing in for
// apps/ui/src/features/catalogue.json: enough features to exercise an exact
// route-segment match, the singular/plural fallback, and an unmatched route.
const testCatalogue = `{
  "version": 0,
  "features": [
    {"id": "analytics", "root": "analytics", "uses": {"screens": ["@langwatch/analytics-web/screens/analytics"], "surfaces": []}},
    {"id": "annotations", "root": "annotation", "uses": {"screens": ["@langwatch/annotation-web/annotations"], "surfaces": []}}
  ]
}`

// writeCatalogue writes testCatalogue at CatalogueFile under root, so
// LoadModuleIndex(root) reads it the same way it reads the real one.
func writeCatalogue(t *testing.T, root string) {
	t.Helper()
	path := filepath.Join(root, CatalogueFile)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("mkdir catalog dir: %v", err)
	}
	if err := os.WriteFile(path, []byte(testCatalogue), 0o600); err != nil {
		t.Fatalf("write catalog fixture: %v", err)
	}
}

// @scenario "Findings stream while the run is still going"
func TestModuleIndexGuessesFromCatalogue(t *testing.T) {
	root := t.TempDir()
	writeCatalogue(t, root)

	index, err := LoadModuleIndex(root)
	if err != nil {
		t.Fatalf("LoadModuleIndex: %v", err)
	}

	t.Run("given an exact route-segment match", func(t *testing.T) {
		if got := index.lookup("analytics"); got != "analytics" {
			t.Errorf("lookup(analytics) = %q", got)
		}
	})

	t.Run("given a plural route segment the catalogue's own root is singular for", func(t *testing.T) {
		if got := index.lookup("annotations"); got != "annotation" {
			t.Errorf("lookup(annotations) = %q, want the module for the singular \"annotation\" root", got)
		}
	})

	t.Run("given a route segment no feature claims", func(t *testing.T) {
		if got := index.lookup("nonexistent-screen"); got != "" {
			t.Errorf("lookup(nonexistent-screen) = %q, want empty", got)
		}
	})

	t.Run("given routeModuleKey strips the {slug} placeholder", func(t *testing.T) {
		if got := routeModuleKey("/{slug}/analytics/custom"); got != "analytics" {
			t.Errorf("routeModuleKey = %q", got)
		}
	})

	t.Run("given moduleKey reads a flow id's leading word", func(t *testing.T) {
		if got := moduleKey("prompt-create"); got != "prompt" {
			t.Errorf("moduleKey(prompt-create) = %q", got)
		}
	})
}

func TestLoadModuleIndexOnAMissingFileIsAnError(t *testing.T) {
	if _, err := LoadModuleIndex(t.TempDir()); err == nil {
		t.Fatal("expected an error reading a catalogue.json that does not exist")
	}
}
