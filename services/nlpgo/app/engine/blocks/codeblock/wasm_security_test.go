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
