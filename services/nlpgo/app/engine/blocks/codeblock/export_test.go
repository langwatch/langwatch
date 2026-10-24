package codeblock

import (
	"os"
	"os/exec"
	"path/filepath"
)

func init() {
	testRuntime = os.Getenv("NLPGO_CODEBLOCK_TEST_RUNTIME")
	testPythonWasmHome = PythonWasmHomeForTests()
	if _, err := os.Stat(QuickJSWasmForTests()); err == nil {
		testQuickJSWasm = QuickJSWasmForTests()
		testTypeScriptWasm = buildTypeScriptWasmForTests()
	}
	if testRuntime == RuntimeWasm || testQuickJSWasm != "" {
		// Compile the guests once up front, so no test's timing includes it.
		_, _ = New(Options{})
	}
}

// PythonWasmHomeForTests is where scripts/fetch-python-wasm.sh puts the runtime.
func PythonWasmHomeForTests() string {
	if home := os.Getenv("NLPGO_TEST_PYTHON_WASM_HOME"); home != "" {
		return home
	}
	home, _ := filepath.Abs("../../../../.cache/python-wasm")
	return home
}

// QuickJSWasmForTests is where scripts/fetch-quickjs-wasm.sh puts qjs-wasi.wasm.
func QuickJSWasmForTests() string {
	if path := os.Getenv("NLPGO_TEST_QUICKJS_WASM"); path != "" {
		return path
	}
	path, _ := filepath.Abs("../../../../.cache/quickjs-wasm/qjs-wasi.wasm")
	return path
}

// TypeScriptWasmForTests is where scripts/build-tsstrip-wasm.sh puts tsstrip.wasm.
func TypeScriptWasmForTests() string {
	if path := os.Getenv("NLPGO_TEST_TYPESCRIPT_WASM"); path != "" {
		return path
	}
	path, _ := filepath.Abs("../../../../.cache/tsstrip-wasm/tsstrip.wasm")
	return path
}

// buildTypeScriptWasmForTests builds tsstrip.wasm from this tree, so the tests
// never run a stale one; Go's build cache makes a rebuild cheap.
func buildTypeScriptWasmForTests() string {
	path := TypeScriptWasmForTests()
	if os.Getenv("NLPGO_TEST_TYPESCRIPT_WASM") != "" {
		return path
	}
	build := exec.Command("go", "build", "-trimpath", "-o", path, "./tsstrip")
	build.Env = append(os.Environ(), "GOOS=wasip1", "GOARCH=wasm", "CGO_ENABLED=0")
	if out, err := build.CombinedOutput(); err != nil {
		panic("codeblock tests: build tsstrip.wasm: " + string(out))
	}
	return path
}
