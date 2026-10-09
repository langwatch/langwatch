package pinnedrelease

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

// @scenario "Haven fetches a pinned, checksummed Alloy instead of building it"
func TestUnzipTakesTheNamedMember(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "alloy.zip")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, body := range map[string]string{"README.md": "readme", "alloy-darwin-arm64": "binary"} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	got, err := unzip(archive, "alloy-darwin-arm64", dir)
	if err != nil {
		t.Fatalf("unzip: %v", err)
	}
	if body, _ := os.ReadFile(got); string(body) != "binary" {
		t.Errorf("unzipped %q, want the member's bytes", body)
	}
	if _, err := unzip(archive, "missing", dir); err == nil {
		t.Error("a member not in the zip must be an error")
	}
}
