package codeblock_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ssrf"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// newJSExec builds an executor that runs JavaScript. CI fetches QuickJS first
// (scripts/fetch-quickjs-wasm.sh), so a missing binary fails there.
func newJSExec(t *testing.T, opts codeblock.Options) *codeblock.Executor {
	t.Helper()
	path := codeblock.QuickJSWasmForTests()
	if _, err := os.Stat(path); err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("qjs-wasi.wasm missing at %s: run services/nlpgo/scripts/fetch-quickjs-wasm.sh", path)
		}
		t.Skipf("qjs-wasi.wasm missing at %s: run services/nlpgo/scripts/fetch-quickjs-wasm.sh", path)
	}
	opts.QuickJSWasm = path
	opts.TypeScriptWasm = codeblock.TypeScriptWasmForTests()
	e, err := codeblock.New(opts)
	require.NoError(t, err)
	return e
}

func runJS(t *testing.T, e *codeblock.Executor, req codeblock.Request) *codeblock.Result {
	t.Helper()
	req.Language = codeblock.LanguageJavaScript
	res, err := e.Execute(context.Background(), req)
	require.NoError(t, err)
	return res
}

func runJSOK(t *testing.T, e *codeblock.Executor, req codeblock.Request) map[string]any {
	t.Helper()
	res := runJS(t, e, req)
	require.Nil(t, res.Error, "expected no error, got %+v (stderr %q)", res.Error, res.Stderr)
	return res.Outputs
}

// @scenario "a JavaScript code block returns its outputs"
func TestJavaScript_DefaultExportReturnsOutputs(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	for name, code := range map[string]string{
		"default function": "export default function ({ question }) { return { output: question.toUpperCase() } }",
		"async default":    "export default async ({ question }) => { await null; return { output: question.toUpperCase() } }",
		"named execute":    "export function execute({ question }) { return { output: question.toUpperCase() } }",
		"default class":    "export default class Code { execute({ question }) { return { output: question.toUpperCase() } } }",
	} {
		t.Run(name, func(t *testing.T) {
			out := runJSOK(t, e, codeblock.Request{
				Code:            code,
				Inputs:          map[string]any{"question": "hi"},
				DeclaredOutputs: []string{"output"},
			})
			assert.Equal(t, "HI", out["output"])
		})
	}
}

// @scenario "a JavaScript code block that throws reports the error"
func TestJavaScript_ThrownErrorIsReported(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runJS(t, e, codeblock.Request{
		Code: "export default function () {\n  throw new RangeError('too big')\n}\n",
	})
	require.NotNil(t, res.Error)
	assert.Equal(t, "RangeError", res.Error.Type)
	assert.Equal(t, "too big", res.Error.Message)
	assert.Contains(t, res.Error.Traceback, "code-block.mjs:2")
}

// @scenario "a JavaScript code block missing a declared output fails"
func TestJavaScript_MissingDeclaredOutputFails(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runJS(t, e, codeblock.Request{
		Code:            "export default () => ({ other: 1 })",
		DeclaredOutputs: []string{"output"},
	})
	require.NotNil(t, res.Error)
	assert.Contains(t, res.Error.Message, "missing_output: output")
}

// @scenario "a JavaScript code block reads secrets and params"
func TestJavaScript_SecretsParamsAndConsole(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runJS(t, e, codeblock.Request{
		Code: `export default function () {
  console.log("hello", { n: 1 })
  console.error("careful")
  let unknown
  try { secrets.NOPE } catch (e) { unknown = e.name }
  return { token: secrets.TOKEN, limit: params.LIMIT + 1, unknown }
}`,
		Secrets: map[string]string{"TOKEN": "s3cret"},
		Params:  map[string]any{"LIMIT": 41},
	})
	require.Nil(t, res.Error, "%+v", res.Error)
	assert.Equal(t, "s3cret", res.Outputs["token"])
	assert.InDelta(t, 42, res.Outputs["limit"], 0)
	assert.Equal(t, "ReferenceError", res.Outputs["unknown"])
	assert.Equal(t, "hello {\"n\":1}\n", res.Stdout)
	assert.Equal(t, "careful\n", res.Stderr)
}

// @scenario "a JavaScript code block calls fetch on a permitted host"
func TestJavaScript_FetchReachesAPermittedHost(t *testing.T) {
	var mu sync.Mutex
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("X-Probe"))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"method": %q, "says": "héllo"}`, r.Method)
	}))
	defer server.Close()

	e := newJSExec(t, codeblock.Options{Egress: ssrf.Options{AllowLocal: true}})
	out := runJSOK(t, e, codeblock.Request{
		Code: `export default async function ({ url }) {
  const a = await fetch(url + "/a?q=1", { headers: { "X-Probe": "js" } })
  const b = await fetch(url + "/b", { method: "post", body: JSON.stringify({ k: "ü" }) })
  const body = await a.json()
  return { method: body.method, says: body.says, status: b.status, type: a.headers.get("content-type") }
}`,
		Inputs: map[string]any{"url": server.URL},
	})
	assert.Equal(t, "GET", out["method"])
	assert.Equal(t, "héllo", out["says"])
	assert.InDelta(t, 200, out["status"], 0)
	assert.Equal(t, "application/json", out["type"])
	assert.Contains(t, seen, "GET /a?q=1 js")
}

// @scenario "a JavaScript code block's requests follow the deployment's egress policy"
func TestJavaScript_EgressPolicyRefusesMetadataAddresses(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	out := runJSOK(t, e, codeblock.Request{
		Code: `export default async function ({ urls }) {
  const outcomes = {}
  for (const url of urls) {
    try { outcomes[url] = await (await fetch(url)).text() }
    catch (e) { outcomes[url] = e.name + ": " + e.message }
  }
  return { outcomes }
}`,
		Inputs: map[string]any{"urls": []any{
			"http://169.254.169.254/latest/meta-data/",
			"http://metadata.google.internal/computeMetadata/v1/",
			"http://127.0.0.1:1/",
		}},
	})
	outcomes, ok := out["outcomes"].(map[string]any)
	require.True(t, ok)
	for url, outcome := range outcomes {
		assert.Contains(t, outcome, "not permitted", "unexpected outcome for %s", url)
	}
}

// @scenario "a JavaScript code block has no host access"
func TestJavaScript_NoHostAccess(t *testing.T) {
	t.Setenv("NLPGO_PROBE_SECRET", "engine-only")
	e := newJSExec(t, codeblock.Options{})
	out := runJSOK(t, e, codeblock.Request{
		Code: `import * as std from "qjs:std"
import * as os from "qjs:os"
export default function () {
  const env = std.getenviron()
  const paths = ["/etc/passwd", "/proc/self/environ", "/runner/runner.mjs"]
  const readable = paths.filter((p) => std.loadFile(p) !== null)
  const runner = std.open("/runner/runner.mjs", "w")
  if (runner) { runner.puts("POISON"); runner.close() }
  const planted = std.open("/runner/planted.mjs", "w")
  if (planted) { planted.puts("POISON"); planted.close() }
  return {
    env: Object.keys(env).sort(),
    readable,
    runnerPoisoned: std.loadFile("/runner/runner.mjs").startsWith("POISON"),
    planted: std.loadFile("/runner/planted.mjs") !== null,
    exec: typeof os.exec,
  }
}`,
	})
	assert.ElementsMatch(t, []any{"HOME", "TMPDIR"}, out["env"])
	assert.Equal(t, []any{"/runner/runner.mjs"}, out["readable"])
	assert.Equal(t, false, out["runnerPoisoned"], "user code rewrote the runner")
	assert.Equal(t, false, out["planted"], "user code planted a file on the runner mount")
	assert.Equal(t, "undefined", out["exec"])
}

// @scenario "a JavaScript code block is stopped at its deadline"
func TestJavaScript_DeadlineStopsTimersAndLoops(t *testing.T) {
	e := newJSExec(t, codeblock.Options{DefaultTimeout: 30 * time.Second})
	for name, code := range map[string]string{
		"busy loop": "export default () => { for (;;) {} }",
		"timer":     "export default () => new Promise((r) => setTimeout(r, 30000))",
	} {
		t.Run(name, func(t *testing.T) {
			start := time.Now()
			res := runJS(t, e, codeblock.Request{Code: code, Timeout: 700 * time.Millisecond})
			assert.True(t, res.TimedOut)
			require.NotNil(t, res.Error)
			assert.Equal(t, codeblock.TimeoutType, res.Error.Type)
			assert.Less(t, time.Since(start), 3*time.Second)
		})
	}
}

func TestJavaScript_TimersRun(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	out := runJSOK(t, e, codeblock.Request{
		Code: `export default async () => {
  const t0 = Date.now()
  await new Promise((r) => setTimeout(r, 50))
  let ticks = 0
  await new Promise((r) => { const h = setInterval(() => { if (++ticks === 3) { clearInterval(h); r() } }, 5) })
  return { waited: Date.now() - t0 >= 50, ticks }
}`,
	})
	assert.Equal(t, true, out["waited"])
	assert.InDelta(t, 3, out["ticks"], 0)
}

// @scenario "a deployment without QuickJS refuses JavaScript code blocks"
func TestJavaScript_RefusedWithoutQuickJS(t *testing.T) {
	// An explicit runtime keeps the package's test hook from configuring QuickJS.
	e, err := codeblock.New(codeblock.Options{Runtime: codeblock.RuntimeSubprocess})
	require.NoError(t, err)
	_, err = e.Execute(context.Background(), codeblock.Request{
		Language: codeblock.LanguageJavaScript,
		Code:     "export default () => ({})",
	})
	require.ErrorContains(t, err, "not available")
}

func runTS(t *testing.T, e *codeblock.Executor, req codeblock.Request) *codeblock.Result {
	t.Helper()
	req.Language = codeblock.LanguageTypeScript
	res, err := e.Execute(context.Background(), req)
	require.NoError(t, err)
	return res
}

// @scenario "a TypeScript code block runs with its types erased"
func TestTypeScript_RunsWithTypesErased(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runTS(t, e, codeblock.Request{
		Code: `interface Inputs { question: string }
type Outputs = { output: string; count: number }
enum Mode { Loud = "LOUD" }

export default async function ({ question }: Inputs): Promise<Outputs> {
  const words = question.split(" ") as string[];
  return { output: ` + "`${Mode.Loud}:${question.toUpperCase()}`" + `, count: words.length };
}
`,
		Inputs:          map[string]any{"question": "hi there"},
		DeclaredOutputs: []string{"output", "count"},
	})
	require.Nil(t, res.Error, "expected no error, got %+v (stderr %q)", res.Error, res.Stderr)
	assert.Equal(t, "LOUD:HI THERE", res.Outputs["output"])
	assert.InDelta(t, 2, res.Outputs["count"], 0)
}

// @scenario "a TypeScript code block with a type error still runs"
func TestTypeScript_TypeErrorsDoNotStopTheRun(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runTS(t, e, codeblock.Request{
		Code:            "export default function (): { output: string } {\n  const n: string = 42 as any as number;\n  return { output: n as unknown as string };\n}\n",
		DeclaredOutputs: []string{"output"},
	})
	require.Nil(t, res.Error, "expected no error, got %+v", res.Error)
	assert.InDelta(t, 42, res.Outputs["output"], 0)
}

// @scenario "a TypeScript code block that does not parse reports the line"
func TestTypeScript_SyntaxErrorReportsItsLine(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runTS(t, e, codeblock.Request{
		Code: "export default function () {\n  const x: = 1;\n  return { x };\n}\n",
	})
	require.NotNil(t, res.Error)
	assert.Equal(t, "SyntaxError", res.Error.Type)
	assert.Contains(t, res.Error.Traceback, "code-block.ts:2:")
}

// @scenario "a TypeScript code block that throws points at the line it was written on"
func TestTypeScript_ThrownErrorPointsAtTheTypeScriptLine(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runTS(t, e, codeblock.Request{
		Code: "// a comment esbuild drops\n\ninterface Big { size: number }\n\n\nexport default function (): Big {\n  throw new RangeError('too big')\n}\n",
	})
	require.NotNil(t, res.Error)
	assert.Equal(t, "RangeError", res.Error.Type)
	assert.Contains(t, res.Error.Traceback, "code-block.ts:7")
	assert.NotContains(t, res.Error.Traceback, "code-block.mjs")
}

// @scenario "a TypeScript code block's size is bounded before it is parsed"
func TestTypeScript_SizeIsBoundedBeforeParsing(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runTS(t, e, codeblock.Request{
		Code: "export default () => ({});\n" + strings.Repeat("//", 64<<10),
	})
	require.NotNil(t, res.Error)
	assert.Equal(t, codeblock.RunnerErrorType, res.Error.Type)
	assert.Contains(t, res.Error.Message, "limited to 64 KB")

	// The worst nesting that fits the limit parses without taking the engine down.
	deep := "export default () => ({ v: " + strings.Repeat("(", 32<<10) + "1" + strings.Repeat(")", 32<<10)
	res = runTS(t, e, codeblock.Request{Code: deep[:min(len(deep), 64<<10)]})
	require.NotNil(t, res.Error)
	assert.Equal(t, "SyntaxError", res.Error.Type)
}

// @scenario "a deployment without tsstrip refuses TypeScript code blocks"
func TestTypeScript_RefusedWithoutTsstrip(t *testing.T) {
	newJSExec(t, codeblock.Options{})
	e, err := codeblock.New(codeblock.Options{QuickJSWasm: codeblock.QuickJSWasmForTests()})
	require.NoError(t, err)
	res := runTS(t, e, codeblock.Request{Code: "export default () => ({})"})
	require.NotNil(t, res.Error)
	assert.Equal(t, codeblock.RunnerErrorType, res.Error.Type)
	assert.Contains(t, res.Error.Message, "not available")
}

// @scenario "a TypeScript code block's types are erased inside the sandbox, within the run's deadline"
func TestTypeScript_ErasureIsHeldToTheRunsDeadline(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	slow := "export default () => ({});\nlet x = " + strings.Repeat("a < ", (60<<10)/4) + "1;\n"
	started := time.Now()
	res := runTS(t, e, codeblock.Request{Code: slow, Timeout: 2 * time.Second})
	require.NotNil(t, res.Error)
	assert.Equal(t, codeblock.TimeoutType, res.Error.Type)
	assert.True(t, res.TimedOut)
	assert.Less(t, time.Since(started), 6*time.Second, "the erasure ran past the deadline")

	deep := "export default () => ({});\nlet y = " + strings.Repeat("!", 60<<10) + "1;\n"
	res = runTS(t, e, codeblock.Request{Code: deep})
	require.NotNil(t, res.Error)
	assert.Equal(t, "SyntaxError", res.Error.Type)
}

// @scenario "customer code cannot report an error the engine reserves"
func TestJavaScript_ForgedTimeoutIsNotATimeout(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	res := runJS(t, e, codeblock.Request{
		Code: "export default () => { const e = new Error('not a timeout'); e.name = 'Timeout'; throw e }",
	})
	require.NotNil(t, res.Error)
	assert.Equal(t, "User"+codeblock.TimeoutType, res.Error.Type)
	assert.False(t, res.TimedOut)
}

// @scenario "customer code cannot report an error the engine reserves"
func TestJavaScript_ErrorWithHostileFieldsIsStillTheCustomers(t *testing.T) {
	e := newJSExec(t, codeblock.Options{})
	for _, code := range []string{
		"export default () => { const e = new Error('x'); e.name = { not: 'a string' }; throw e }",
		"export default () => { const e = new Error('x'); Object.defineProperty(e, 'name', { get() { throw 1 } }); throw e }",
		"export default () => { throw { toJSON() { throw 1 }, toString() { throw 1 } } }",
	} {
		res := runJS(t, e, codeblock.Request{Code: code})
		require.NotNil(t, res.Error, code)
		assert.NotEqual(t, codeblock.RunnerErrorType, res.Error.Type, code)
	}
}
