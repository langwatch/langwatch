package codeblock

import (
	"bytes"
	"context"
	"crypto/rand"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing/fstest"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"
)

// wasmSite is the guest-only Python: the host bridge and the requests/httpx
// stand-ins built on it. The subprocess runtime never sees these files.
//
//go:embed all:wasmsite
var wasmSite embed.FS

// runnerMjsSource is the JavaScript runner QuickJS starts with.
//
//go:embed runner.mjs
var runnerMjsSource []byte

// Guest paths. The stdlib and the runner are read-only; /work is the run's own.
const (
	guestPythonHome = "/usr/local"
	guestRunnerDir  = "/runner"
	guestWorkDir    = "/work"
	wasmPageBytes   = 64 << 10
)

// sharedCompilationCache compiles each guest binary once per process, however
// many executors are built.
var sharedCompilationCache = wazero.NewCompilationCache()

// defaultWasmMemoryMiB caps one run's linear memory.
const defaultWasmMemoryMiB = 512

// wasmRuntime runs code blocks inside WebAssembly guests: a WASI CPython when
// Python runs on wasm, and QuickJS for JavaScript. Each module is compiled
// once; every run instantiates it afresh with its own memory and mounts, so
// nothing one run does is visible to another and no process outlives a run.
type wasmRuntime struct {
	runtime wazero.Runtime
	python  *wasmGuest
	js      *wasmGuest
	client  *http.Client
	opts    Options
}

// wasmGuest is one interpreter: its compiled module, its read-only mounts and
// how it is started. A run adds only its own /work directory.
type wasmGuest struct {
	module wazero.CompiledModule
	mounts map[string]fs.FS
	args   []string
	env    map[string]string
}

// runnerPair is the runner and the dspy stand-in it imports.
type runnerPair struct {
	runner, fakeDspy []byte
}

// newWasmRuntime builds the guests opts asks for: Python when opts.Runtime is
// RuntimeWasm, JavaScript when opts.QuickJSWasm names a qjs-wasi.wasm.
func newWasmRuntime(ctx context.Context, opts Options, sources runnerPair) (*wasmRuntime, error) {
	memoryMiB := opts.WasmMemoryMiB
	if memoryMiB <= 0 {
		memoryMiB = defaultWasmMemoryMiB
	}
	// Debug info off: with it, wazero symbolizes every trap against the
	// guest's DWARF, which held a timed-out run seconds past its deadline.
	config := wazero.NewRuntimeConfig().
		WithDebugInfoEnabled(false).
		WithCloseOnContextDone(true).
		WithMemoryLimitPages(uint32(memoryMiB << 20 / wasmPageBytes))
	cache := sharedCompilationCache
	if opts.WasmCompilationCacheDir != "" {
		dirCache, err := wazero.NewCompilationCacheWithDir(opts.WasmCompilationCacheDir)
		if err != nil {
			return nil, fmt.Errorf("codeblock: wasm compilation cache: %w", err)
		}
		cache = dirCache
	}
	config = config.WithCompilationCache(cache)
	w := &wasmRuntime{
		runtime: wazero.NewRuntimeWithConfig(ctx, config),
		client:  newFetchClient(opts.Egress),
		opts:    opts,
	}
	if _, err := wasi_snapshot_preview1.Instantiate(ctx, w.runtime); err != nil {
		_ = w.runtime.Close(ctx)
		return nil, fmt.Errorf("codeblock: wasi: %w", err)
	}
	var err error
	if opts.Runtime == RuntimeWasm {
		w.python, err = w.pythonGuest(ctx, sources)
	}
	if err == nil && opts.QuickJSWasm != "" {
		w.js, err = w.javascriptGuest(ctx)
	}
	if err != nil {
		_ = w.runtime.Close(ctx)
		return nil, err
	}
	return w, nil
}

func (w *wasmRuntime) compile(ctx context.Context, path string) (wazero.CompiledModule, error) {
	binary, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("codeblock: read %s: %w", filepath.Base(path), err)
	}
	module, err := w.runtime.CompileModule(ctx, binary)
	if err != nil {
		return nil, fmt.Errorf("codeblock: compile %s: %w", filepath.Base(path), err)
	}
	return module, nil
}

func (w *wasmRuntime) pythonGuest(ctx context.Context, sources runnerPair) (*wasmGuest, error) {
	home := w.opts.PythonWasmHome
	if home == "" {
		return nil, errors.New("codeblock: the wasm runtime needs PythonWasmHome")
	}
	module, err := w.compile(ctx, filepath.Join(home, "python.wasm"))
	if err != nil {
		return nil, err
	}
	stdlib, err := loadStdlib(filepath.Join(home, "lib"))
	if err != nil {
		return nil, err
	}
	runner, err := guestRunnerFS(sources)
	if err != nil {
		return nil, err
	}
	return &wasmGuest{
		module: module,
		mounts: map[string]fs.FS{guestPythonHome + "/lib": stdlib, guestRunnerDir: runner},
		args:   []string{"python", "-S", "-B", "-u", guestRunnerDir + "/runner.py", guestWorkDir + "/result.json"},
		env: map[string]string{
			"PYTHONHOME":              guestPythonHome,
			"PYTHONPATH":              guestRunnerDir,
			"PYTHONDONTWRITEBYTECODE": "1",
			"PYTHONIOENCODING":        "utf-8",
		},
	}, nil
}

func (w *wasmRuntime) javascriptGuest(ctx context.Context) (*wasmGuest, error) {
	module, err := w.compile(ctx, w.opts.QuickJSWasm)
	if err != nil {
		return nil, err
	}
	runner := fstest.MapFS{"runner.mjs": {Data: runnerMjsSource, Mode: 0o444}}
	return &wasmGuest{
		module: module,
		mounts: map[string]fs.FS{guestRunnerDir: runner},
		args:   []string{"qjs", "--module", guestRunnerDir + "/runner.mjs", guestWorkDir + "/result.json"},
	}, nil
}

// loadStdlib reads the standard library into memory once. Served from memory,
// an import costs no host filesystem calls; from a directory mount, CPython's
// path probing made imports two to four times slower.
func loadStdlib(dir string) (fs.FS, error) {
	files := fstest.MapFS{}
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		data, err := os.ReadFile(path) //nolint:gosec // path comes from walking the operator's PythonWasmHome
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(rel)] = &fstest.MapFile{Data: data, Mode: 0o444}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("codeblock: python stdlib: %w", err)
	}
	return files, nil
}

// guestRunnerFS is the read-only /runner mount: the runner pair plus wasmsite.
func guestRunnerFS(sources runnerPair) (fs.FS, error) {
	files := fstest.MapFS{
		"runner.py":    {Data: sources.runner, Mode: 0o444},
		"fake_dspy.py": {Data: sources.fakeDspy, Mode: 0o444},
	}
	err := fs.WalkDir(wasmSite, "wasmsite", func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		data, err := wasmSite.ReadFile(path)
		if err != nil {
			return err
		}
		files[strings.TrimPrefix(path, "wasmsite/")] = &fstest.MapFile{Data: data, Mode: 0o444}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("codeblock: wasm site files: %w", err)
	}
	return files, nil
}

// wasmRun is what one guest execution reports back to Execute.
type wasmRun struct {
	stderr   string
	exitCode uint32
	err      error
}

// wasmRunRequest is one execution: the run directory, mounted read-write at
// /work to receive result.json, the stdin payload and the run's own env.
type wasmRunRequest struct {
	runDir  string
	payload []byte
	env     []string
}

// run executes one code block on guest. The guest sees no host path but runDir.
func (w *wasmRuntime) run(ctx context.Context, guest *wasmGuest, req wasmRunRequest) wasmRun {
	channel := w.newBridge(ctx, req.payload)
	var stderr limitedBuffer
	stderr.limit = maxStrayOutputBytes

	fsConfig := wazero.NewFSConfig()
	for at, files := range guest.mounts {
		fsConfig = fsConfig.WithFSMount(files, at)
	}
	fsConfig = fsConfig.WithDirMount(req.runDir, guestWorkDir)
	config := wazero.NewModuleConfig().
		WithName("").
		WithArgs(guest.args...).
		WithStdin(channel).
		WithStdout(channel).
		WithStderr(&stderr).
		WithFSConfig(fsConfig).
		WithSysWalltime().
		WithSysNanotime().
		WithNanosleep(func(ns int64) { sleepUntilDone(ctx, time.Duration(ns)) }).
		WithRandSource(cryptoRand{}).
		WithEnv("HOME", guestWorkDir).
		WithEnv("TMPDIR", guestWorkDir)
	for name, value := range guest.env {
		config = config.WithEnv(name, value)
	}
	for _, kv := range req.env {
		name, value, _ := strings.Cut(kv, "=")
		config = config.WithEnv(name, value)
	}

	instance, err := w.runtime.InstantiateModule(ctx, guest.module, config)
	if instance != nil {
		_ = instance.Close(context.WithoutCancel(ctx))
	}
	stray := channel.close()
	out := wasmRun{stderr: stderr.String()}
	if stray != "" {
		out.stderr += stray
	}
	var exit *sys.ExitError
	switch {
	case err == nil:
	case errors.As(err, &exit):
		out.exitCode = exit.ExitCode()
	default:
		out.err = err
	}
	return out
}

// sleepUntilDone is the guest's sleep: it ends early when the run's time is up.
func sleepUntilDone(ctx context.Context, d time.Duration) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
	}
}

// limitedBuffer keeps the first limit bytes written and drops the rest.
type limitedBuffer struct {
	buf   bytes.Buffer
	limit int
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	if room := l.limit - l.buf.Len(); room > 0 {
		if len(p) > room {
			l.buf.Write(p[:room])
		} else {
			l.buf.Write(p)
		}
	}
	return len(p), nil
}

func (l *limitedBuffer) String() string { return l.buf.String() }

// cryptoRand seeds the guest's random source (hash seeds, uuid4, secrets).
type cryptoRand struct{}

func (cryptoRand) Read(p []byte) (int, error) { return rand.Read(p) }
