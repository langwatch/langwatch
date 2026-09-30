package enforcer

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/internal/collate"
	"github.com/langwatch/langwatch/tools/internal/tsscan"
	"github.com/langwatch/langwatch/tools/internal/workspace"
)

// browser-node-leak (frontend/browser-node-leak.ts).

// nodeBuiltins is `builtinModules` of Node 24, each also as `node:<name>`.
var nodeBuiltins = func() map[string]bool {
	names := strings.Fields(`_http_agent _http_client _http_common _http_incoming _http_outgoing _http_server
		_stream_duplex _stream_passthrough _stream_readable _stream_transform _stream_wrap _stream_writable
		_tls_common _tls_wrap assert assert/strict async_hooks buffer child_process cluster console constants
		crypto dgram diagnostics_channel dns dns/promises domain events fs fs/promises http http2 https inspector
		inspector/promises module net os path path/posix path/win32 perf_hooks process punycode querystring
		readline readline/promises repl stream stream/consumers stream/promises stream/web string_decoder sys
		timers timers/promises tls trace_events tty url util util/types v8 vm wasi worker_threads zlib
		node:sea node:sqlite node:test node:test/reporters`)
	set := map[string]bool{}
	for _, name := range names {
		set[name] = true
		set["node:"+strings.TrimPrefix(name, "node:")] = true
	}
	return set
}()

var browserReachable = regexp.MustCompile(`-(?:contract|browser|browser-kit)$`)

func isBrowserReachable(name string) bool {
	return browserReachable.MatchString(name) || name == "@langwatch/design-system" || name == "@langwatch/browser-host"
}

// browserRoots are the entry files of every browser-reachable package, by name.
func browserRoots(s *workspace.Snapshot) []string {
	type entry struct{ name, file string }
	var roots []entry
	for _, name := range s.Resolver.Order {
		if !isBrowserReachable(name) {
			continue
		}
		if file := s.Resolver.Resolve(name, s.Root+"/package.json"); file != "" {
			roots = append(roots, entry{name, file})
		}
	}
	sort.SliceStable(roots, func(i, j int) bool { return collate.Compare(roots[i].name, roots[j].name) < 0 })
	files := make([]string, len(roots))
	for i, r := range roots {
		files[i] = r.file
	}
	return files
}

func isValueImport(imp tsscan.Import) bool { return !imp.TypeOnly && !imp.NonLiteral }

// valueWalk is walkValueImportGraph with a Node-builtin forbidden edge.
type valueWalk struct {
	s     *workspace.Snapshot
	seen  map[string]bool
	seeds map[string]string
	queue []string
}

func (w *valueWalk) push(file string) {
	if !w.seen[file] {
		w.seen[file] = true
		w.queue = append(w.queue, file)
	}
}

// edges records the file's first builtin as its seed and queues what it reaches.
func (w *valueWalk) edges(file string, facts *tsscan.File) {
	for _, imp := range facts.Imports {
		if !isValueImport(imp) {
			continue
		}
		if nodeBuiltins[imp.Specifier] {
			if _, ok := w.seeds[file]; !ok {
				w.seeds[file] = imp.Specifier
			}
			continue
		}
		if target := w.s.Resolver.Resolve(imp.Specifier, file); target != "" {
			w.push(target)
		}
	}
}

func (w *valueWalk) run() {
	for len(w.queue) > 0 {
		file := w.queue[len(w.queue)-1]
		w.queue = w.queue[:len(w.queue)-1]
		if facts := w.s.Facts(file); facts != nil {
			w.edges(file, facts)
		}
	}
}

// importLine is the line of the file's first value import of specifier.
func importLine(facts *tsscan.File, specifier string) int {
	for _, imp := range facts.Imports {
		if isValueImport(imp) && imp.Specifier == specifier {
			return imp.Line
		}
	}
	return 0
}

// BrowserNodeLeaks is lintBrowserNodeLeaks.
func BrowserNodeLeaks(s *workspace.Snapshot) ([]Violation, error) {
	w := &valueWalk{s: s, seen: map[string]bool{}, seeds: map[string]string{}}
	for _, file := range browserRoots(s) {
		w.push(file)
	}
	w.run()
	out := make([]Violation, 0, len(w.seeds))
	for file, specifier := range w.seeds {
		out = append(out, Violation{Policy: "browser-node-leak", File: file, Line: importLine(s.Facts(file), specifier), Specifier: specifier,
			Message: fmt.Sprintf("`%s` is a Node.js builtin, imported here in a file a browser-reachable package (a *-contract, *-browser or *-browser-kit package, or the Design System) can reach.", specifier),
			Allowed: "Move the Node-only code behind a leaf subpath export the browser never resolves — the pattern @langwatch/secrets and @langwatch/kernel use (ADR-132) — so the package's default entry stays portable."})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if c := collate.Compare(out[i].File, out[j].File); c != 0 {
			return c < 0
		}
		return out[i].Line < out[j].Line
	})
	return out, nil
}
