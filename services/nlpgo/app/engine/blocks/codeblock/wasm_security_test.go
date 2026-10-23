package codeblock_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ssrf"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// @scenario "on the wasm runtime, a code block cannot leave its run directory"
func TestWasmSecurity_PathsCannotLeaveTheRunDirectory(t *testing.T) {
	outside := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(outside, "host-secret.txt"), []byte("host-only"), 0o600))

	e := newWasmExec(t, codeblock.Options{})
	out := runOK(t, e, codeblock.Request{
		Code: `
import os

def execute(outside):
    attempts = {}
    def attempt(name, fn):
        try:
            attempts[name] = fn()
        except Exception as exc:
            attempts[name] = "refused: " + type(exc).__name__
    attempt("dotdot", lambda: open("/work/../../../../" + outside + "/host-secret.txt").read())
    attempt("relative", lambda: open("../" * 12 + outside.lstrip("/") + "/host-secret.txt").read())
    def via_symlink():
        os.symlink(outside + "/host-secret.txt", "link")
        return open("link").read()
    attempt("symlink", via_symlink)
    def via_dir_symlink():
        os.symlink("/", "root")
        return ",".join(os.listdir("root"))
    attempt("dir_symlink", via_dir_symlink)
    def via_hardlink():
        os.link(outside + "/host-secret.txt", "hard")
        return open("hard").read()
    attempt("hardlink", via_hardlink)
    return attempts
`,
		Inputs: map[string]any{"outside": outside},
	})
	for name, outcome := range out {
		assert.NotContains(t, outcome, "host-only", "%s read a host file outside the run", name)
	}
}

// @scenario "on the wasm runtime, a symlink a run leaves behind cannot reach the host"
func TestWasmSecurity_SymlinkLeftInTheRunDirectoryStaysInside(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{})
	out := runOK(t, e, codeblock.Request{
		Code: `
import os

def execute():
    try:
        os.symlink("/etc/passwd", "passwd")
        return {"read": open("passwd").read()[:40]}
    except OSError as exc:
        return {"read": "refused: " + type(exc).__name__}
`,
	})
	assert.NotContains(t, out["read"], "root:", "a symlink resolved against the host filesystem")
}

// @scenario "the host bridge refuses malformed, unknown and excessive calls"
func TestWasmSecurity_BridgeRefusesMalformedUnknownAndExcessiveCalls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	defer server.Close()

	e := newJSExec(t, codeblock.Options{Egress: ssrf.Options{AllowLocal: true}})
	out := runJSOK(t, e, codeblock.Request{
		Code: `import * as std from "qjs:std"
const call = (raw) => {
  std.out.puts("\x1eLWHOST " + raw + "\n"); std.out.flush()
  return JSON.parse(std.in.getline())
}
export default async function ({ url }) {
  const garbage = call("{not json")
  const unknown = call(JSON.stringify({ op: "exec", cmd: "id" }))
  let allowed = 0, refused = null
  for (let i = 0; i < 80; i++) {
    try { await fetch(url); allowed++ } catch (e) { refused = e.message; break }
  }
  return { garbage: garbage.kind, unknown: unknown.kind, allowed, refused }
}`,
		Inputs: map[string]any{"url": server.URL},
	})
	assert.Equal(t, "protocol", out["garbage"])
	assert.Equal(t, "protocol", out["unknown"])
	assert.InDelta(t, 64, out["allowed"], 0, "the per-run request budget is 64")
	assert.Contains(t, out["refused"], "at most 64 requests")
}

// @scenario "the host bridge refuses an oversized call without exhausting the engine"
func TestWasmSecurity_BridgeRefusesAnOversizedFrame(t *testing.T) {
	e := newJSExec(t, codeblock.Options{Egress: ssrf.Options{AllowLocal: true}})
	out := runJSOK(t, e, codeblock.Request{
		Code: `export default async function () {
  try {
    await fetch("http://127.0.0.1:1/", { method: "POST", body: "x".repeat(17 * 1024 * 1024) })
    return { outcome: "sent" }
  } catch (e) { return { outcome: e.message } }
}`,
	})
	assert.Contains(t, out["outcome"], "limit", "a 17 MiB call was not refused: %v", out["outcome"])
}

// @scenario "on the wasm runtime, a redirect cannot reach a refused address"
func TestWasmSecurity_RedirectToAMetadataAddressIsRefused(t *testing.T) {
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/", http.StatusFound)
	}))
	defer redirector.Close()

	// The first hop is local, so local egress is allowed; the metadata range never is.
	opts := codeblock.Options{Egress: ssrf.Options{AllowLocal: true}}
	t.Run("python", func(t *testing.T) {
		out := runOK(t, newWasmExec(t, opts), codeblock.Request{
			Code: `
import requests

def execute(url):
    try:
        return {"outcome": requests.get(url, timeout=3).text}
    except requests.RequestException as exc:
        return {"outcome": str(exc)}
`,
			Inputs: map[string]any{"url": redirector.URL},
		})
		assert.Contains(t, out["outcome"], "not permitted")
	})
	t.Run("javascript", func(t *testing.T) {
		out := runJSOK(t, newJSExec(t, opts), codeblock.Request{
			Code: `export default async ({ url }) => {
  try { return { outcome: await (await fetch(url)).text() } }
  catch (e) { return { outcome: e.message } }
}`,
			Inputs: map[string]any{"url": redirector.URL},
		})
		assert.Contains(t, out["outcome"], "not permitted")
	})
}

// @scenario "encoded, loopback, private and non-HTTP destinations are refused"
func TestWasmSecurity_EgressRefusesEncodedAndNonHTTPDestinations(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	out := runJSOK(t, e, codeblock.Request{
		Code: `export default async ({ urls }) => {
  const outcomes = {}
  for (const url of urls) {
    try { outcomes[url] = await (await fetch(url)).text() }
    catch (e) { outcomes[url] = e.message }
  }
  return { outcomes }
}`,
		Inputs: map[string]any{"urls": []any{
			"http://[::ffff:169.254.169.254]/latest/meta-data/",
			"http://2852039166/latest/meta-data/",
			"http://0251.0376.0251.0376/",
			"http://localhost:5561/go/studio/execute_sync",
			"http://[::1]/",
			"http://10.0.0.1/",
			"file:///etc/passwd",
			"gopher://127.0.0.1:6379/_INFO",
		}},
	})
	outcomes, ok := out["outcomes"].(map[string]any)
	require.True(t, ok)
	for url, outcome := range outcomes {
		text, _ := outcome.(string)
		assert.True(t, strings.Contains(text, "not permitted") || strings.Contains(text, "fetch failed"),
			"%s was not refused: %q", url, text)
		assert.NotContains(t, text, "root:", "%s read a host file", url)
	}
}

// @scenario "a JavaScript code block is held to its memory ceiling"
func TestWasmSecurity_JavaScriptMemoryCeiling(t *testing.T) {
	e := newJSExec(t, codeblock.Options{WasmMemoryMiB: 64})
	res := runJS(t, e, codeblock.Request{
		Code: `export default () => {
  const chunks = []
  for (;;) chunks.push(new Uint8Array(8 * 1024 * 1024))
}`,
	})
	require.NotNil(t, res.Error, "an unbounded allocation succeeded under a 64 MiB ceiling")
	assert.False(t, res.TimedOut)

	after := runJSOK(t, e, codeblock.Request{Code: "export default () => ({ ok: true })"})
	assert.Equal(t, true, after["ok"], "the executor did not survive a run that ran out of memory")
}

// @scenario "a JavaScript code block that recurses without end fails on its own"
func TestWasmSecurity_JavaScriptStackOverflowFailsTheRunOnly(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runJS(t, e, codeblock.Request{
		Code: "const down = (n) => down(n + 1)\nexport default () => down(0)\n",
	})
	require.NotNil(t, res.Error)
	assert.NotEqual(t, codeblock.TimeoutType, res.Error.Type)
}

// @scenario "a JavaScript code block cannot see another run's state"
func TestWasmSecurity_JavaScriptRunsShareNoState(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	const runs = 8
	var wg sync.WaitGroup
	results := make([]map[string]any, runs)
	for i := range runs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := e.Execute(context.Background(), codeblock.Request{
				Language: codeblock.LanguageJavaScript,
				Code: `import * as std from "qjs:std"
export default ({ n }) => {
  const seenGlobal = globalThis.__mark ?? null
  globalThis.__mark = n
  const seenFile = std.loadFile("/work/mark.txt")
  const f = std.open("/work/mark.txt", "w"); f.puts(String(n)); f.close()
  return { seenGlobal, seenFile, token: secrets.TOKEN }
}`,
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
		assert.Nil(t, out["seenGlobal"], "run %d saw another run's global", i)
		assert.Nil(t, out["seenFile"], "run %d saw another run's file", i)
		assert.Equal(t, fmt.Sprintf("secret-%d", i), out["token"], "run %d read another run's secret", i)
	}
}

// @scenario "an oversized result is refused instead of read into the engine"
func TestWasmSecurity_OversizedResultIsRefused(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runJS(t, e, codeblock.Request{
		Code: `export default () => ({ blob: "x".repeat(40 * 1024 * 1024) })`,
	})
	require.NotNil(t, res.Error)
	assert.Equal(t, codeblock.RunnerErrorType, res.Error.Type)
	assert.Contains(t, res.Error.Message, "result exceeds")
	assert.Empty(t, res.Outputs)
}

// @scenario "on the wasm runtime, a relative link cannot climb out of the run directory"
func TestWasmSecurity_RelativeLinksAreRefused(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{})
	out := runOK(t, e, codeblock.Request{
		Code: `
import os

def execute():
    outcomes = {}
    for name, target in (("up", ".."), ("deep", "../../.."), ("self", ".")):
        try:
            os.symlink(target, name)
            outcomes[name] = "linked: " + ",".join(sorted(os.listdir(name))[:10])
        except OSError as exc:
            outcomes[name] = "refused: " + type(exc).__name__
    return outcomes
`,
	})
	for name, outcome := range out {
		assert.Contains(t, outcome, "refused", "link %s was created: %v", name, outcome)
	}
}

// @scenario "on the wasm runtime, a run's files are held to a size, count and open-file budget"
func TestWasmSecurity_WorkDirectoryHasABudget(t *testing.T) {
	e := newWasmExec(t, codeblock.Options{})
	out := runOK(t, e, codeblock.Request{
		Code: `
import os

def execute():
    outcomes = {}
    chunk = b"x" * (1 << 20)
    written = 0
    try:
        with open("big.bin", "wb") as handle:
            for _ in range(200):
                handle.write(chunk)
                handle.flush()
                written += 1
        outcomes["bytes"] = "unbounded"
    except OSError:
        outcomes["bytes"] = "stopped"
    os.remove("big.bin")
    try:
        for i in range(10000):
            open("f%d" % i, "w").close()
        outcomes["files"] = "unbounded"
    except OSError:
        outcomes["files"] = "stopped"
    handles = []
    try:
        for _ in range(1000):
            handles.append(open("f0"))
        outcomes["open"] = "unbounded"
    except OSError:
        outcomes["open"] = "stopped"
    for handle in handles:
        handle.close()
    for name in os.listdir("."):
        os.remove(name)
    outcomes["written_mib"] = written
    return outcomes
`,
	})
	assert.Equal(t, "stopped", out["bytes"], "a run wrote 200 MiB into /work")
	assert.Equal(t, "stopped", out["files"], "a run created 10000 files")
	assert.Equal(t, "stopped", out["open"], "a run held 1000 files open")
	assert.Less(t, out["written_mib"], float64(70))

	after := runOK(t, e, codeblock.Request{Code: "def execute():\n    open('x', 'w').write('ok')\n    return {'ok': open('x').read()}\n"})
	assert.Equal(t, "ok", after["ok"], "a later run inherited a full /work")
}

// @scenario "a run that keeps making failing host calls is stopped"
func TestWasmSecurity_FailingCallsStopTheRun(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	start := time.Now()
	res := runJS(t, e, codeblock.Request{
		Code: `import * as std from "qjs:std"
export default () => {
  const frame = "\x1eLWHOST " + JSON.stringify({ op: "nope", pad: "x".repeat(4096) }) + "\n"
  for (;;) { std.out.puts(frame); std.out.flush() }
}`,
		Timeout: 20 * time.Second,
	})
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Message, "failing host calls")
	assert.Less(t, time.Since(start), 5*time.Second, "the run was not stopped when its calls kept failing")
}

// @scenario "a run that ignores the host's replies is stopped, not buffered"
func TestWasmSecurity_UnreadRepliesStopTheRun(t *testing.T) {
	big := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(make([]byte, 8<<20))
	}))
	defer big.Close()

	e := newJSExec(t, codeblock.Options{Egress: ssrf.Options{AllowLocal: true}})
	start := time.Now()
	res := runJS(t, e, codeblock.Request{
		Code: `import * as std from "qjs:std"
export default ({ url }) => {
  const frame = "\x1eLWHOST " + JSON.stringify({ op: "fetch", method: "GET", url, headers: {}, body_b64: "" }) + "\n"
  for (let i = 0; i < 20; i++) { std.out.puts(frame); std.out.flush() }
  return {}
}`,
		Inputs:  map[string]any{"url": big.URL},
		Timeout: 20 * time.Second,
	})
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Message, "without reading their replies")
	assert.Less(t, time.Since(start), 15*time.Second)
}

// @scenario "concurrent wasm runs share a memory budget"
func TestWasmSecurity_ConcurrentRunsWaitForMemory(t *testing.T) {
	// One run's footprint (64 memory + 64 /work + 32 replies + 32 request)
	// is 192 MiB, so this budget admits one run at a time.
	e := newJSExec(t, codeblock.Options{WasmMemoryMiB: 64, WasmTotalMemoryMiB: 200})
	var wg sync.WaitGroup
	start := time.Now()
	for range 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := e.Execute(context.Background(), codeblock.Request{
				Language: codeblock.LanguageJavaScript,
				Code:     "export default () => new Promise((r) => setTimeout(() => r({}), 300))",
			})
			assert.NoError(t, err)
			assert.Nil(t, res.Error)
		}()
	}
	wg.Wait()
	assert.GreaterOrEqual(t, time.Since(start), 900*time.Millisecond, "runs past the memory budget were not held back")

	ctx, cancel := context.WithCancel(context.Background())
	release := make(chan struct{})
	go func() {
		_, _ = e.Execute(context.Background(), codeblock.Request{
			Language: codeblock.LanguageJavaScript,
			Code:     "export default () => new Promise((r) => setTimeout(() => r({}), 1500))",
		})
		close(release)
	}()
	time.Sleep(200 * time.Millisecond)
	cancel()
	res, err := e.Execute(ctx, codeblock.Request{Language: codeblock.LanguageJavaScript, Code: "export default () => ({})"})
	require.NoError(t, err)
	require.NotNil(t, res.Error, "a cancelled run waiting for room was not reported")
	assert.Contains(t, res.Error.Message, "as many code blocks as its memory allows")
	<-release
}

// @scenario "an engine whose memory budget cannot admit one run refuses to start"
func TestWasmSecurity_BudgetBelowOneRunIsRefused(t *testing.T) {
	_, err := codeblock.New(codeblock.Options{
		QuickJSWasm:        codeblock.QuickJSWasmForTests(),
		WasmMemoryMiB:      64,
		WasmTotalMemoryMiB: 100,
	})
	require.ErrorContains(t, err, "100 MiB")
	require.ErrorContains(t, err, "192 MiB")
}

// @scenario "a run's request is charged to the memory budget and capped"
func TestWasmSecurity_OversizedRequestIsRefused(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runJS(t, e, codeblock.Request{
		Code:   "export default () => ({})",
		Inputs: map[string]any{"blob": strings.Repeat("x", 17<<20)},
	})
	require.NotNil(t, res.Error)
	assert.Equal(t, codeblock.RunnerErrorType, res.Error.Type)
	assert.Contains(t, res.Error.Message, "16 MiB")
}

// @scenario "an engine error reaches the user without the guest's stack trace"
func TestWasmSecurity_EngineErrorsAreOneLine(t *testing.T) {
	e := newJSExec(t, codeblock.Options{WasmMemoryMiB: 64})
	res := runJS(t, e, codeblock.Request{
		Code: `export default () => {
  const chunks = []
  for (;;) chunks.push(new Uint8Array(8 * 1024 * 1024))
}`,
	})
	require.NotNil(t, res.Error)
	assert.NotContains(t, res.Error.Message, "\n")
	assert.NotContains(t, res.Error.Message, "wasm stack trace")
}
