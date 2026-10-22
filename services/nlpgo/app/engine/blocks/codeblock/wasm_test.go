package codeblock_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ssrf"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// newWasmExec builds a wasm-runtime executor. CI fetches the runtime first
// (scripts/fetch-python-wasm.sh), so a missing runtime fails there.
func newWasmExec(t *testing.T, opts codeblock.Options) *codeblock.Executor {
	t.Helper()
	home := codeblock.PythonWasmHomeForTests()
	if _, err := os.Stat(filepath.Join(home, "python.wasm")); err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("python.wasm missing at %s: run services/nlpgo/scripts/fetch-python-wasm.sh", home)
		}
		t.Skipf("python.wasm missing at %s: run services/nlpgo/scripts/fetch-python-wasm.sh", home)
	}
	opts.Runtime = codeblock.RuntimeWasm
	opts.PythonWasmHome = home
	e, err := codeblock.New(opts)
	require.NoError(t, err)
	require.Equal(t, codeblock.RuntimeWasm, e.Runtime())
	return e
}

func runOK(t *testing.T, e *codeblock.Executor, req codeblock.Request) map[string]any {
	t.Helper()
	res, err := e.Execute(context.Background(), req)
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected no error, got %+v (stderr %q)", res.Error, res.Stderr)
	return res.Outputs
}

// @scenario "a code block cannot leave a process running after its execution"
func TestWasm_NoProcessOutlivesARun(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{})
	out := runOK(t, e, codeblock.Request{
		Code: `
import os, subprocess

def execute():
    results = {}
    try:
        results["fork"] = str(os.fork())
    except Exception as exc:
        results["fork"] = type(exc).__name__
    try:
        subprocess.Popen(["/bin/sh", "-c", "sleep 100"])
        results["popen"] = "started"
    except Exception as exc:
        results["popen"] = type(exc).__name__
    try:
        import threading
        threading.Thread(target=lambda: None).start()
        results["thread"] = "started"
    except Exception as exc:
        results["thread"] = type(exc).__name__
    return results
`,
	})
	assert.NotEqual(t, "started", out["popen"], "a wasm run started a process")
	assert.NotEqual(t, "started", out["thread"], "a wasm run started a thread that could outlive it")
	_, forked := out["fork"].(string)
	assert.True(t, forked)
	assert.NotRegexp(t, `^\d+$`, out["fork"], "a wasm run forked")
}

// @scenario "user code cannot change what a later execution runs"
func TestWasm_RunnerMountIsReadOnly(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{})
	out := runOK(t, e, codeblock.Request{
		Code: `
import os, sys

def execute():
    attempts = {}
    for name in ("runner.py", "fake_dspy.py", "_lw_host.py", "requests/__init__.py", "planted.py"):
        path = os.path.join(os.path.dirname(sys.argv[0]), name)
        try:
            with open(path, "w") as handle:
                handle.write("POISON = True\n")
            attempts[name] = "written"
        except OSError as exc:
            attempts[name] = type(exc).__name__
    return attempts
`,
	})
	for name, outcome := range out {
		assert.NotEqual(t, "written", outcome, "user code rewrote %s on the runner mount", name)
	}
}

// @scenario "each execution gets its own temporary directory, removed afterwards"
func TestWasm_RunsDoNotShareAFilesystem(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{})
	probe := codeblock.Request{
		Code: `
import os

def execute():
    seen = os.path.exists("left-behind.txt")
    with open("left-behind.txt", "w") as handle:
        handle.write("x")
    host_paths = [p for p in ("/etc", "/tmp", "/proc", "/home", "/Users", "/var") if os.path.exists(p)]
    return {"cwd": os.getcwd(), "saw_previous": seen, "host_paths": host_paths}
`,
	}
	first := runOK(t, e, probe)
	second := runOK(t, e, probe)
	assert.Equal(t, "/work", first["cwd"])
	assert.Equal(t, false, second["saw_previous"], "the second run saw a file the first one wrote")
	assert.Empty(t, second["host_paths"], "the guest sees host paths beyond its own mounts")
}

// @scenario "a code block cannot read the engine's environment or process table"
func TestWasm_EngineEnvironmentAndProcIsUnreachable(t *testing.T) {
	t.Setenv("AWS_SECRET_ACCESS_KEY", "CANARY_AWS_SECRET_DO_NOT_LEAK")
	t.Setenv("LANGWATCH_NLP_INTERNAL_SECRET", "CANARY_INTERNAL_DO_NOT_LEAK")
	e := newWasmExec(t, codeblock.Options{})
	out := runOK(t, e, codeblock.Request{
		Code: `
import os

def execute():
    found = []
    for pid in ("1", "self"):
        try:
            found.append(open("/proc/" + pid + "/environ", "rb").read().decode("latin1"))
        except OSError:
            pass
    return {"env": dict(os.environ), "proc": found}
`,
	})
	env, ok := out["env"].(map[string]any)
	require.True(t, ok)
	assert.NotContains(t, env, "AWS_SECRET_ACCESS_KEY")
	assert.NotContains(t, env, "LANGWATCH_NLP_INTERNAL_SECRET")
	assert.Empty(t, out["proc"], "the guest read a process environment through /proc")
}

func TestWasm_SandboxCredentialIsTheOnlyCredentialInTheEnvironment(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{SandboxEndpoint: "https://lw.example"})
	out := runOK(t, e, codeblock.Request{
		Code:          "import os\ndef execute():\n    return {'key': os.environ.get('LANGWATCH_API_KEY'), 'endpoint': os.environ.get('LANGWATCH_ENDPOINT')}\n",
		SandboxAPIKey: "sk-run-only",
	})
	assert.Equal(t, "sk-run-only", out["key"])
	assert.Equal(t, "https://lw.example", out["endpoint"])
}

func TestWasm_RequestsAndHttpxReachAPermittedHost(t *testing.T) {
	var mu sync.Mutex
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("X-Probe"))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"method": %q}`, r.Method)
	}))
	defer server.Close()

	e := newWasmExec(t, codeblock.Options{Egress: ssrf.Options{AllowLocal: true}})
	out := runOK(t, e, codeblock.Request{
		Code: `
import asyncio, httpx, requests

def execute(url):
    a = requests.get(url + "/a", params={"q": "1"}, headers={"X-Probe": "requests"})
    a.raise_for_status()
    b = requests.Session().post(url + "/b", json={"k": "v"})
    with httpx.Client(base_url=url, headers={"X-Probe": "httpx"}) as client:
        c = client.put("/c", content=b"raw")

    async def go():
        async with httpx.AsyncClient() as client:
            return (await client.delete(url + "/d")).json()["method"]

    return {"a": a.json()["method"], "b": b.status_code, "c": c.is_success, "d": asyncio.run(go())}
`,
		Inputs: map[string]any{"url": server.URL},
	})
	assert.Equal(t, "GET", out["a"])
	assert.InDelta(t, 200, out["b"], 0)
	assert.Equal(t, true, out["c"])
	assert.Equal(t, "DELETE", out["d"])
	assert.Contains(t, seen, "GET /a?q=1 requests")
	assert.Contains(t, seen, "PUT /c httpx")
}

// @scenario "a code block's outbound requests follow the deployment's egress policy"
func TestWasm_EgressPolicyRefusesPrivateAndMetadataAddresses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("reached"))
	}))
	defer server.Close()

	e := newWasmExec(t, codeblock.Options{})
	out := runOK(t, e, codeblock.Request{
		Code: `
import requests

def execute(urls):
    outcomes = {}
    for url in urls:
        try:
            outcomes[url] = requests.get(url, timeout=2).text
        except requests.RequestException as exc:
            outcomes[url] = type(exc).__name__ + ": " + str(exc)
    return {"outcomes": outcomes}
`,
		Inputs: map[string]any{"urls": []any{
			server.URL,
			"http://169.254.169.254/latest/meta-data/",
			"http://metadata.google.internal/computeMetadata/v1/",
		}},
	})
	outcomes, ok := out["outcomes"].(map[string]any)
	require.True(t, ok)
	for url, outcome := range outcomes {
		assert.NotEqual(t, "reached", outcome, "the guest reached %s", url)
		assert.Contains(t, outcome, "not permitted", "unexpected outcome for %s", url)
	}
}

func TestWasm_SleepEndsAtTheRunsDeadline(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{DefaultTimeout: 30 * time.Second})
	start := time.Now()
	res, err := e.Execute(context.Background(), codeblock.Request{
		Code:    "import time\ndef execute():\n    time.sleep(30)\n    return {}\n",
		Timeout: 700 * time.Millisecond,
	})
	require.NoError(t, err)
	assert.True(t, res.TimedOut)
	assert.Less(t, time.Since(start), 3*time.Second)
}

func TestWasm_BusyLoopEndsAtTheRunsDeadline(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{DefaultTimeout: 30 * time.Second})
	start := time.Now()
	res, err := e.Execute(context.Background(), codeblock.Request{
		Code:    "def execute():\n    while True:\n        pass\n",
		Timeout: 700 * time.Millisecond,
	})
	require.NoError(t, err)
	assert.True(t, res.TimedOut)
	require.NotNil(t, res.Error)
	assert.Equal(t, codeblock.TimeoutType, res.Error.Type)
	assert.Less(t, time.Since(start), 3*time.Second)
}

func TestWasm_MemoryCeilingStopsARunawayAllocation(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{WasmMemoryMiB: 128})
	res, err := e.Execute(context.Background(), codeblock.Request{
		Code: "def execute():\n    blob = bytearray(512 * 1024 * 1024)\n    return {'n': len(blob)}\n",
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error, "a 512 MiB allocation succeeded under a 128 MiB ceiling")
	assert.Equal(t, "MemoryError", res.Error.Type)
}

func TestWasm_ConcurrentRunsStayIndependent(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{})
	const runs = 8
	var wg sync.WaitGroup
	results := make([]map[string]any, runs)
	for i := range runs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := e.Execute(context.Background(), codeblock.Request{
				Code: `
import os

def execute(n):
    with open("mine.txt", "w") as handle:
        handle.write(str(n))
    return {"n": int(open("mine.txt").read()), "files": os.listdir(".")}
`,
				Inputs:  map[string]any{"n": i},
				Secrets: map[string]string{"TOKEN": fmt.Sprintf("secret-%d", i)},
			})
			if err == nil && res.Error == nil {
				results[i] = res.Outputs
			}
		}()
	}
	wg.Wait()
	for i, out := range results {
		require.NotNil(t, out, "run %d failed", i)
		assert.InDelta(t, i, out["n"], 0, "run %d read another run's file", i)
	}
}
