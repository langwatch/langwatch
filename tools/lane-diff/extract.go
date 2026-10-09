package lanediff

import (
	"regexp"
	"sort"
	"strings"
)

// Tree is one ref's TypeScript source: path to content.
type Tree map[string]string

// Lane is one key of the worker's job registry, `pipeline:jobType:name`.
type Lane struct {
	Pipeline string
	JobType  string
	Name     string
	File     string
	Line     int
	// Unresolved is set when a name could not be resolved to a literal;
	// Pipeline or Name then carries the source expression prefixed with "?".
	Unresolved bool
	// Heuristic is set when a name came from a definition's first `name:`.
	Heuristic bool
}

// Key is the registry key the worker looks a job up by.
func (l Lane) Key() string { return l.Pipeline + ":" + l.JobType + ":" + l.Name }

// Drain is a head pipeline's `.withUpcasts({ drain })`: jobs queued under
// the former pipeline route to the declaring pipeline's lanes.
type Drain struct {
	Former   string
	Current  string
	JobNames map[string]string
	File     string
}

// ProcessManager is a declared process manager; its name is also the
// process name its outbox leases.
type ProcessManager struct {
	Pipeline string
	Name     string
	File     string
	Line     int
}

// Registry is everything one ref's worker would register, read statically.
type Registry struct {
	Pipelines       map[string]string // name -> declaring file
	Lanes           []Lane
	ProcessManagers []ProcessManager
	Drains          []Drain
	EventTypes      map[string]bool
}

// method describes how a builder method maps to a registry lane.
type method struct {
	jobType string
	// global lanes register on the shared "global" pipeline.
	global bool
	// prefix prepends `<pipeline>.` to the name (peer lanes).
	prefix bool
	// prop is the property of the argument object that holds the definition
	// whose name is the lane name (peer fold and map projections).
	prop string
	// receiver, when set, is the object the call must be made on.
	receiver string
	// nameArg is the argument holding the name or definition (default 0).
	nameArg int
}

// methods is the union of both trees' builder vocabularies; a method only
// one tree declares never matches in the other.
var methods = map[string]method{
	"withCommand":                  {jobType: "command"},
	"withCommandInstance":          {jobType: "command"},
	"withFoldProjection":           {jobType: "projection"},
	"withClickHouseFoldProjection": {jobType: "projection"},
	"withMapProjection":            {jobType: "handler"},
	"withClickHouseMapProjection":  {jobType: "handler"},
	"withProjection":               {jobType: "stateProjection"},
	"withPostgresProjection":       {jobType: "stateProjection"},
	"withEventSubscriber":          {jobType: "subscriber"},
	"withSubscriber":               {jobType: "subscriber|reactor"},
	"withProjectionSubscriber":     {jobType: "reactor"},
	"withProcessManager":           {jobType: "subscriber"},
	"withPeerSubscriber":           {jobType: "subscriber", global: true, prefix: true},
	"withPeerFoldProjection":       {jobType: "projection", global: true, prefix: true, prop: "fold"},
	"withPeerMapProjection":        {jobType: "handler", global: true, prefix: true, prop: "map"},
	"withGlobalMapProjection":      {jobType: "handler", global: true},
	"registerJob":                  {jobType: "job"},
	"registerMapProjection":        {jobType: "handler", global: true, receiver: "projectionRegistry"},
	"registerMapSubscriber":        {jobType: "reactor", global: true, receiver: "projectionRegistry", nameArg: 1},
}

var (
	methodCall   = regexp.MustCompile(`\.(with[A-Za-z]+|registerJob|registerMapProjection|registerMapSubscriber)\s*`)
	anchorName   = regexp.MustCompile(`\.withName\s*\(`)
	anchorDefine = regexp.MustCompile(`\bdefinePipeline\s*\(`)
	upcastsCall  = regexp.MustCompile(`\.withUpcasts\s*\(`)
	eventLiteral = regexp.MustCompile("[\"'`](lw\\.[a-z0-9_]+(?:\\.[a-z0-9_]+)+)[\"'`]")
	declPattern  = regexp.MustCompile(`(?m)^[ \t]*(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*`)
	classPattern = regexp.MustCompile(`(?m)^[ \t]*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{`)
	funcPattern  = regexp.MustCompile(`(?m)^[ \t]*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]`)
	staticName   = regexp.MustCompile(`(?m)^\s*(?:static\s+)?(?:override\s+)?(?:readonly\s+)?(?:static\s+)?name\s*(?::\s*[^=;\n]+)?=\s*([^;\n]+)`)
	firstNameKey = regexp.MustCompile(`(?:^|[\s{,(])name\s*:\s*`)
)

// decl is one top-level-looking declaration: its initializer or body text.
type decl struct {
	file string
	text string
	kind string // "const", "class" or "function"
}

// Extract reads a tree's registry.
func Extract(tree Tree) Registry {
	idx := index(tree)
	reg := Registry{Pipelines: map[string]string{}, EventTypes: map[string]bool{}}
	paths := make([]string, 0, len(tree))
	for path := range tree {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		src := tree[path]
		for _, m := range eventLiteral.FindAllStringSubmatch(src, -1) {
			reg.EventTypes[m[1]] = true
		}
		extractFile(&reg, idx, path)
	}
	sort.Slice(reg.Lanes, func(i, j int) bool { return reg.Lanes[i].Key() < reg.Lanes[j].Key() })
	return reg
}

type anchor struct {
	at   int
	name resolved
}

// fileScan reads one file's pipeline declarations into reg.
type fileScan struct {
	reg     *Registry
	idx     *indexes
	path    string
	src     string
	anchors []anchor
}

func extractFile(reg *Registry, idx *indexes, path string) {
	src := idx.files[path]
	f := fileScan{reg: reg, idx: idx, path: path, src: src, anchors: pipelineAnchors(idx, path, src)}
	for _, a := range f.anchors {
		if a.name.ok {
			reg.Pipelines[a.name.value] = path
		}
	}
	f.drains()
	for _, loc := range methodCall.FindAllStringSubmatchIndex(src, -1) {
		reg.Lanes = append(reg.Lanes, f.lanes(loc)...)
	}
}

// pipelineAt is the pipeline declared nearest before offset at in the file.
func (f fileScan) pipelineAt(at int) resolved {
	var found resolved
	for _, a := range f.anchors {
		if a.at <= at {
			found = a.name
		}
	}
	if found.value == "" {
		return resolved{value: "?" + f.path}
	}
	return found
}

func (f fileScan) drains() {
	for _, loc := range upcastsCall.FindAllStringIndex(f.src, -1) {
		args, _ := callArgs(f.src, loc[1]-1)
		if len(args) == 0 {
			continue
		}
		drain := objectProps(objectProps(args[0])["drain"])
		if drain == nil {
			continue
		}
		names := map[string]string{}
		for from, to := range objectProps(drain["jobNames"]) {
			names[from] = f.idx.resolve(f.path, to, 0).value
		}
		f.reg.Drains = append(f.reg.Drains, Drain{
			Former:   f.idx.resolve(f.path, drain["pipeline"], 0).value,
			Current:  f.pipelineAt(loc[0]).value,
			JobNames: names,
			File:     f.path,
		})
	}
}

// lanes reads the builder call matched at loc: its lane, and the map
// subscribers a global map projection registers beside it.
func (f fileScan) lanes(loc []int) []Lane {
	lane, args, ok := f.lane(loc)
	if !ok {
		return nil
	}
	out := []Lane{lane}
	if f.src[loc[2]:loc[3]] != "withGlobalMapProjection" || len(args) < 2 {
		return out
	}
	list := strings.TrimSpace(args[1])
	if !strings.HasPrefix(list, "[") || matchClose(list, 0) != len(list)-1 {
		return out
	}
	for _, element := range splitTopLevel(list[1 : len(list)-1]) {
		r := f.idx.resolveDefinition(f.path, element)
		out = append(out, Lane{Pipeline: "global", JobType: "reactor", Name: r.value, File: f.path, Line: lane.Line, Unresolved: !r.ok, Heuristic: r.heuristic})
	}
	return out
}

// lane reads the builder call matched at loc, if it registers a lane.
func (f fileScan) lane(loc []int) (Lane, []string, bool) {
	name := f.src[loc[2]:loc[3]]
	spec, known := methods[name]
	if !known || (spec.receiver != "" && !strings.HasSuffix(receiver(f.src, loc[0]), spec.receiver)) {
		return Lane{}, nil, false
	}
	open := skipSpace(f.src, skipGenerics(f.src, loc[1]))
	if open >= len(f.src) || f.src[open] != '(' {
		return Lane{}, nil, false
	}
	args, _ := callArgs(f.src, open)
	if len(args) <= spec.nameArg {
		return Lane{}, nil, false
	}
	pipe := f.pipelineAt(loc[0])
	lane := Lane{Pipeline: pipe.value, JobType: spec.jobType, File: f.path, Line: lineOf(f.src, loc[0])}
	laneName := f.laneName(builderCall{name: name, spec: spec, args: args, at: loc[0]}, &lane)
	if spec.prefix {
		laneName.value = pipe.value + "." + laneName.value
		laneName.ok = laneName.ok && pipe.ok
	}
	if spec.global {
		lane.Pipeline = "global"
	}
	lane.Name = laneName.value
	lane.Heuristic = laneName.heuristic
	lane.Unresolved = !laneName.ok || strings.HasPrefix(lane.Pipeline, "?")
	return lane, args, true
}

// laneName reads the name a builder call registers, adjusting lane for the
// calls whose job type or pipeline depends on their arguments.
// builderCall is one matched builder method call.
type builderCall struct {
	name string
	spec method
	args []string
	at   int
}

func (f fileScan) laneName(call builderCall, lane *Lane) resolved {
	args := call.args
	switch call.name {
	case "withProcessManager":
		r := f.idx.resolveDefinition(f.path, args[0])
		f.reg.ProcessManagers = append(f.reg.ProcessManagers, ProcessManager{Pipeline: lane.Pipeline, Name: r.value, File: f.path, Line: lane.Line})
		r.value = "pm:" + r.value
		return r
	case "withSubscriber":
		lane.JobType = "subscriber"
		if len(args) > 1 && f.idx.mentionsFoldOrMap(f.path, args[1]) {
			lane.JobType = "reactor"
		}
		return f.idx.resolve(f.path, args[0], 0)
	case "registerJob":
		lane.Pipeline = "?" + receiver(f.src, call.at)
		return f.idx.resolve(f.path, objectProps(args[0])["name"], 0)
	}
	target, file := args[call.spec.nameArg], f.path
	if call.spec.prop != "" {
		target, file, _ = f.idx.propOf(f.path, args[0], call.spec.prop)
	}
	return f.idx.resolveDefinition(file, target)
}

// receiver returns the identifier chain before `.registerJob`, e.g. `tracePipeline.service`.
func receiver(src string, dot int) string {
	start := dot
	for start > 0 {
		c := src[start-1]
		if c == '.' || c == '_' || c == '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			start--
			continue
		}
		break
	}
	return src[start:dot]
}

func pipelineAnchors(idx *indexes, path, src string) []anchor {
	var anchors []anchor
	for _, loc := range anchorName.FindAllStringIndex(src, -1) {
		args, _ := callArgs(src, loc[1]-1)
		if len(args) > 0 {
			anchors = append(anchors, anchor{at: loc[0], name: idx.resolve(path, args[0], 0)})
		}
	}
	for _, loc := range anchorDefine.FindAllStringIndex(src, -1) {
		args, _ := callArgs(src, loc[1]-1)
		if len(args) > 0 {
			if props := objectProps(args[0]); props != nil {
				anchors = append(anchors, anchor{at: loc[0], name: idx.resolve(path, props["name"], 0)})
			}
		}
	}
	sort.Slice(anchors, func(i, j int) bool { return anchors[i].at < anchors[j].at })
	return anchors
}
