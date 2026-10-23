package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWasmRuntimeEnv_PointsAtFetchedRuntimesOnly(t *testing.T) {
	root := t.TempDir()
	if got := wasmRuntimeEnv(root); len(got) != 0 {
		t.Fatalf("unfetched runtimes were configured: %v", got)
	}
	quickjs := filepath.Join(root, "services", "nlpgo", ".cache", "quickjs-wasm", "qjs-wasi.wasm")
	if err := os.MkdirAll(filepath.Dir(quickjs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(quickjs, []byte("wasm"), 0o600); err != nil {
		t.Fatal(err)
	}
	got := wasmRuntimeEnv(root)
	if len(got) != 1 || got[0] != "NLPGO_ENGINE_QUICKJS_WASM="+quickjs {
		t.Fatalf("got %v", got)
	}
}
