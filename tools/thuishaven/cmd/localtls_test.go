package cmd

import (
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLocalHTTPClientTrustsThePortlessCA(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	state := t.TempDir()
	t.Setenv("PORTLESS_STATE_DIR", state)

	if _, err := localHTTPClient(5 * time.Second).Get(srv.URL); err == nil {
		t.Fatal("trusted the test server with no portless CA on disk")
	}

	ca := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw})
	if err := os.WriteFile(filepath.Join(state, "ca.pem"), ca, 0o644); err != nil {
		t.Fatal(err)
	}
	resp, err := localHTTPClient(5 * time.Second).Get(srv.URL)
	if err != nil {
		t.Fatalf("did not trust the portless CA: %v", err)
	}
	_ = resp.Body.Close()
}

func TestLocalRootsFallsBackOnABadCA(t *testing.T) {
	bad := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(bad, []byte("not a cert"), 0o644); err != nil {
		t.Fatal(err)
	}
	if localRoots(bad) != nil || localRoots("") != nil || localRoots(bad+".missing") != nil {
		t.Fatal("a missing or unreadable CA must leave the default roots")
	}
}
