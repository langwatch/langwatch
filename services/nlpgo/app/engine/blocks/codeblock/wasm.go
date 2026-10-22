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

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"
)

// wasmSite is the guest-only Python: the host bridge and the requests/httpx
// stand-ins built on it. The subprocess runtime never sees these files.
//
//go:embed all:wasmsite
var wasmSite embed.FS

// Guest paths. The stdlib and the runner are read-only; /work is the run's own.
const (
	guestPythonHome = "/usr/local"
	guestRunnerDir  = "/runner"
	guestWorkDir    = "/work"
	wasmPageBytes   = 64 << 10
)

// sharedCompilationCache compiles python.wasm once per process, however many
// executors are built.
var sharedCompilationCache = wazero.NewCompilationCache()

// defaultWasmMemoryMiB caps one run's linear memory.
const defaultWasmMemoryMiB = 512

// wasmRuntime runs code blocks inside a WASI CPython. The module is compiled
// once; every run instantiates it afresh with its own memory and mounts, so
// nothing one run does is visible to another and no process outlives a run.
type wasmRuntime struct {
	runtime wazero.Runtime
	module  wazero.CompiledModule
	stdlib  fs.FS
	runner  fs.FS
	client  *http.Client
	opts    Options
}

// runnerPair is the runner and the dspy stand-in it imports.
type runnerPair struct {
	runner, fakeDspy []byte
}

func newWasmRuntime(ctx context.Context, opts Options, sources runnerPair) (*wasmRuntime, error) {
	home := opts.PythonWasmHome
	if home == "" {
		return nil, errors.New("codeblock: the wasm runtime needs PythonWasmHome")
	}
	binary, err := os.ReadFile(filepath.Join(home, "python.wasm"))
	if err != nil {
		return nil, fmt.Errorf("codeblock: read python.wasm: %w", err)
	}
	stdlib, err := loadStdlib(filepath.Join(home, "lib"))
	if err != nil {
		return nil, err
	}

	memoryMiB := opts.WasmMemoryMiB
	if memoryMiB <= 0 {
		memoryMiB = defaultWasmMemoryMiB
	}
	// Debug info off: with it, wazero symbolizes every trap against
	// python.wasm's DWARF, which held a timed-out run seconds past its deadline.
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
	runtime := wazero.NewRuntimeWithConfig(ctx, config)
	if _, err := wasi_snapshot_preview1.Instantiate(ctx, runtime); err != nil {
		_ = runtime.Close(ctx)
		return nil, fmt.Errorf("codeblock: wasi: %w", err)
	}
	module, err := runtime.CompileModule(ctx, binary)
	if err != nil {
		_ = runtime.Close(ctx)
		return nil, fmt.Errorf("codeblock: compile python.wasm: %w", err)
	}

	runner, err := guestRunnerFS(sources)
	if err != nil {
		_ = runtime.Close(ctx)
		return nil, err
	}
	return &wasmRuntime{
		runtime: runtime,
		module:  module,
		stdlib:  stdlib,
		runner:  runner,
		client:  newFetchClient(opts.Egress),
		opts:    opts,
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

// run executes one code block. The guest sees no host path but runDir.
func (w *wasmRuntime) run(ctx context.Context, req wasmRunRequest) wasmRun {
	channel := w.newBridge(ctx, req.payload)
	var stderr limitedBuffer
	stderr.limit = maxStrayOutputBytes

	fsConfig := wazero.NewFSConfig().
		WithFSMount(w.stdlib, guestPythonHome+"/lib").
		WithFSMount(w.runner, guestRunnerDir).
		WithDirMount(req.runDir, guestWorkDir)
	config := wazero.NewModuleConfig().
		WithName("").
		WithArgs("python", "-S", "-B", "-u", guestRunnerDir+"/runner.py", guestWorkDir+"/result.json").
		WithStdin(channel).
		WithStdout(channel).
		WithStderr(&stderr).
		WithFSConfig(fsConfig).
		WithSysWalltime().
		WithSysNanotime().
		WithSysNanosleep().
		WithRandSource(cryptoRand{}).
		WithEnv("PYTHONHOME", guestPythonHome).
		WithEnv("PYTHONPATH", guestRunnerDir).
		WithEnv("PYTHONDONTWRITEBYTECODE", "1").
		WithEnv("PYTHONIOENCODING", "utf-8").
		WithEnv("HOME", guestWorkDir).
		WithEnv("TMPDIR", guestWorkDir)
	for _, kv := range req.env {
		name, value, _ := strings.Cut(kv, "=")
		config = config.WithEnv(name, value)
	}

	instance, err := w.runtime.InstantiateModule(ctx, w.module, config)
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
