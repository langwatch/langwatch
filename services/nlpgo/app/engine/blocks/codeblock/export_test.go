package codeblock

import (
	"os"
	"path/filepath"
)

func init() {
	testRuntime = os.Getenv("NLPGO_CODEBLOCK_TEST_RUNTIME")
	testPythonWasmHome = PythonWasmHomeForTests()
	if _, err := os.Stat(QuickJSWasmForTests()); err == nil {
		testQuickJSWasm = QuickJSWasmForTests()
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
