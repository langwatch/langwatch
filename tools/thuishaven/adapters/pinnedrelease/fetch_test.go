package pinnedrelease

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
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

// @scenario "Two concurrent installs of a pinned binary download it once"
func TestEnsureConcurrentRunsDownloadOnce(t *testing.T) {
	body := []byte("binary")
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	sum := sha256.Sum256(body)
	a := domain.PinnedArtifact{URL: srv.URL + "/tool", SHA256: hex.EncodeToString(sum[:])}
	dest := filepath.Join(t.TempDir(), "bin", "tool")
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := Ensure(context.Background(), a, dest); err != nil {
				t.Errorf("Ensure: %v", err)
			}
		}()
	}
	wg.Wait()
	if got := hits.Load(); got != 1 {
		t.Errorf("downloaded %d times, want once", got)
	}
}
