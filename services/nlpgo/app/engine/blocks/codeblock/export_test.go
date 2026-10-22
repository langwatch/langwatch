package codeblock

import (
	"os"
	"path/filepath"
)

func init() {
	testRuntime = os.Getenv("NLPGO_CODEBLOCK_TEST_RUNTIME")
	testPythonWasmHome = PythonWasmHomeForTests()
	if testRuntime == RuntimeWasm {
		// Compile python.wasm once up front, so no test's timing includes it.
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
