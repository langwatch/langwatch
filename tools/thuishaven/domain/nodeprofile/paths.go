// Package nodeprofile reads the profiles V8 hands out over the Chrome DevTools
// protocol (.cpuprofile, sampling heap profiles, heap snapshots) and rolls them
// up into the few tables an agent acts on: self time by function, file and
// package, inclusive time, heap by package, retained size by constructor.
// It is pure: no I/O beyond the bytes it is given.
package nodeprofile

import (
	"net/url"
	"strings"
)

// workspaceGroups are the repository directories whose children are the unit
// a package rollup names (modules/traces, apps/api), not the directory itself.
var workspaceGroups = map[string]bool{
	"apps": true, "modules": true, "packages": true, "tools": true,
	"services": true, "sdks": true, "langwatch": true,
}

// localPath turns a V8 script URL into a filesystem path: file:// stripped,
// percent-escapes decoded, and a query (the dev runtime's ?lw=<n> reload
// stamp, which arrives escaped as %3Flw=) dropped. Anything that is not a
// file URL keeps its spelling.
func localPath(raw string) string {
	path, ok := strings.CutPrefix(raw, "file://")
	if !ok {
		return raw
	}
	if decoded, err := url.PathUnescape(path); err == nil {
		path = decoded
	}
	if i := strings.IndexAny(path, "?#"); i > 0 {
		path = path[:i]
	}
	return path
}

// afterNodeModules is the part of path past its last node_modules directory
// (pnpm's .pnpm/<dir>/node_modules/<name> included), and whether there was one.
func afterNodeModules(path string) (string, bool) {
	i := strings.LastIndex(path, "/node_modules/")
	if i < 0 {
		return "", false
	}
	return path[i+len("/node_modules/"):], true
}

// DisplayPath is the short spelling of a script URL a reader knows:
// a dependency as <package>/<file>, a repository file relative to root,
// Node's own modules as node:..., and "" for V8's synthetic frames.
func DisplayPath(raw, root string) string {
	if raw == "" {
		return ""
	}
	path := localPath(raw)
	if rest, ok := afterNodeModules(path); ok {
		return rest
	}
	if root != "" {
		if rel, ok := strings.CutPrefix(path, strings.TrimRight(root, "/")+"/"); ok {
			return rel
		}
	}
	return path
}

// PackageOf names the unit a frame's cost rolls up to: the npm package for a
// dependency (pnpm's versioned directories collapse to the package name),
// "node" for Node's built-in modules, the workspace directory (modules/traces,
// apps/api) for repository code, and a parenthesised name for V8's own frames.
func PackageOf(raw, functionName, root string) string {
	if raw == "" {
		switch functionName {
		case "(garbage collector)":
			return "(gc)"
		case "(program)", "(idle)", "(root)":
			return functionName
		}
		return "(native)"
	}
	if strings.HasPrefix(raw, "node:") {
		return "node"
	}
	if strings.HasPrefix(raw, "wasm://") {
		return "wasm"
	}
	path := localPath(raw)
	if rest, ok := afterNodeModules(path); ok {
		return npmName(rest)
	}
	rel := DisplayPath(raw, root)
	segs := strings.Split(rel, "/")
	if len(segs) == 1 {
		return rel
	}
	switch {
	case segs[0] == "enterprise" && len(segs) > 3 && segs[1] == "modules":
		return strings.Join(segs[:3], "/")
	case workspaceGroups[segs[0]] && len(segs) > 2:
		return segs[0] + "/" + segs[1]
	case strings.HasPrefix(rel, "/"):
		return dirOf(rel)
	}
	return segs[0]
}

// npmName is the package name at the start of a path inside node_modules:
// "zod/lib/x.js" is zod, "@scope/name/dist/y.js" is @scope/name.
func npmName(rest string) string {
	segs := strings.SplitN(rest, "/", 3)
	if strings.HasPrefix(segs[0], "@") && len(segs) > 1 {
		return segs[0] + "/" + segs[1]
	}
	return segs[0]
}

func dirOf(path string) string {
	if i := strings.LastIndex(path, "/"); i > 0 {
		return path[:i]
	}
	return path
}

// functionLabel is how a frame's function reads in a table.
func functionLabel(name string) string {
	if name == "" {
		return "(anonymous)"
	}
	return name
}

// GuessRoot is the checkout a profile's scripts load from, for a profile read
// with no stack to ask: the directory most dependency URLs sit under, the one
// holding node_modules. "" when no frame is a dependency.
func GuessRoot(urls []string) string {
	count := map[string]int{}
	best, bestN := "", 0
	for _, raw := range urls {
		path := localPath(raw)
		i := strings.Index(path, "/node_modules/")
		if i <= 0 {
			continue
		}
		dir := path[:i]
		count[dir]++
		if n := count[dir]; n > bestN || (n == bestN && dir < best) {
			best, bestN = dir, n
		}
	}
	return best
}

// URLs lists the profile's script URLs, one per node.
func (p CPUProfile) URLs() []string {
	out := make([]string, 0, len(p.Nodes))
	for _, n := range p.Nodes {
		if n.CallFrame.URL != "" {
			out = append(out, n.CallFrame.URL)
		}
	}
	return out
}
