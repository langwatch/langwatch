package apidiff

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// StreamSurface names which API surface a streamed finding describes. REST is
// the only surface apidiff probes today; trpc is reserved for when the
// procedure-manifest seam closes (see README, "Not covered").
type StreamSurface string

// Findings stream surfaces.
const (
	StreamSurfaceREST StreamSurface = "rest"
	StreamSurfaceTRPC StreamSurface = "trpc"
)

// StreamKind classifies one operation's comparison outcome for the findings
// stream — a small, reader-facing taxonomy, coarser than the ledger's own
// classification enum (see ledger.go).
type StreamKind string

// Findings stream kinds.
const (
	StreamAbsentOnBranch StreamKind = "absent-on-branch"
	StreamStatusDiffers  StreamKind = "status-differs"
	StreamShapeDiffers   StreamKind = "shape-differs"
	StreamIdentical      StreamKind = "identical"
	StreamProbeFailed    StreamKind = "probe-failed"
)

// StreamEntry is one line of the findings stream: one operation's comparison
// outcome, written as it completes rather than batched at the end.
type StreamEntry struct {
	Surface    StreamSurface `json:"surface"`
	Name       string        `json:"name"`
	Kind       StreamKind    `json:"kind"`
	Module     string        `json:"module"`
	Detail     string        `json:"detail"`
	CapturedAt string        `json:"capturedAt"`
}

// runComplete is the findings stream's closing line: totals by kind.
type runComplete struct {
	Kind   string         `json:"kind"`
	Counts map[string]int `json:"counts"`
}

// FindingsStream appends one JSON line per entry to a writer — a real file
// under .apidiff/<runID>/findings.jsonl in production, an in-memory buffer in
// tests. Every Append is its own Write with nothing buffered across entries,
// so a reader tailing the file sees each one as it lands; a writer that can
// Sync (a real file) is synced too, so a line survives a crash before the
// next one.
type FindingsStream struct {
	w      io.Writer
	counts map[string]int
}

// NewFindingsStream opens (creating if needed) <runDir>/findings.jsonl for
// append and returns the stream plus its own close func.
func NewFindingsStream(runDir string) (*FindingsStream, func() error, error) {
	// #nosec G304 -- path is built from the run directory this tool created.
	file, err := os.OpenFile(filepath.Join(runDir, "findings.jsonl"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, nil, err
	}
	return newFindingsStream(file), file.Close, nil
}

// newFindingsStream wraps any writer — tests use an in-memory one — so the
// stream's shape is independent of its destination.
func newFindingsStream(w io.Writer) *FindingsStream {
	return &FindingsStream{w: w, counts: map[string]int{}}
}

// Append writes one entry as its own JSON line and flushes it (Sync, for a
// real file) before returning.
func (stream *FindingsStream) Append(entry StreamEntry) error {
	if entry.CapturedAt == "" {
		entry.CapturedAt = time.Now().UTC().Format(time.RFC3339)
	}
	stream.counts[string(entry.Kind)]++
	return stream.writeLine(entry)
}

// Close writes the run-complete line with the totals by kind.
func (stream *FindingsStream) Close() error {
	return stream.writeLine(runComplete{Kind: "run-complete", Counts: stream.counts})
}

func (stream *FindingsStream) writeLine(value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := stream.w.Write(append(encoded, '\n')); err != nil {
		return err
	}
	if syncer, ok := stream.w.(interface{ Sync() error }); ok {
		return syncer.Sync()
	}
	return nil
}

// classifyOperation reduces one operation's probe outcome to the findings
// stream's small taxonomy plus a one-line detail. Missing-on-branch and probe
// failures win over a mere status or shape difference, since they say more
// about what could not be compared at all.
func classifyOperation(operation Operation, findings []Finding) (StreamKind, string) {
	if !operation.InA {
		return StreamAbsentOnBranch, "present on base only"
	}
	if finding, ok := firstOfKind(findings, FindingProbeFailed, FindingSkipped); ok {
		return StreamProbeFailed, detailFor(finding)
	}
	if finding, ok := firstOfKind(findings, FindingOperationMissing); ok {
		return StreamAbsentOnBranch, detailFor(finding)
	}
	if finding, ok := firstOfKind(findings, FindingStatusDiff); ok {
		return StreamStatusDiffers, detailFor(finding)
	}
	if len(findings) == 0 {
		return StreamIdentical, ""
	}
	return StreamShapeDiffers, detailFor(findings[0])
}

// firstOfKind returns the first finding whose Kind is one of kinds.
func firstOfKind(findings []Finding, kinds ...string) (Finding, bool) {
	for _, finding := range findings {
		for _, kind := range kinds {
			if finding.Kind == kind {
				return finding, true
			}
		}
	}
	return Finding{}, false
}

// detailFor renders one finding as the one line the stream carries: the
// reason it was not compared, the status pair, or the changed field pointers.
func detailFor(finding Finding) string {
	if finding.Reason != "" {
		return finding.Reason
	}
	if status, ok := finding.Fields["status"]; ok {
		return fmt.Sprintf("status %v -> %v", status[0], status[1])
	}
	if len(finding.Fields) == 0 {
		return finding.Kind
	}
	pointers := make([]string, 0, len(finding.Fields))
	for pointer := range finding.Fields {
		pointers = append(pointers, pointer)
	}
	sort.Strings(pointers)
	return strings.Join(pointers, ", ")
}

// findingsHook adapts a FindingsStream into the callback ProbeAll fires as
// each operation's comparison completes. Returns nil when stream is nil (the
// plain `probe` subcommand has no run directory to stream into), which
// ProbeOptions treats as no hook at all.
func findingsHook(stream *FindingsStream, repoRoot string, stderr io.Writer) func(Operation, []Finding) {
	if stream == nil {
		return nil
	}
	return func(operation Operation, findings []Finding) {
		kind, detail := classifyOperation(operation, findings)
		entry := StreamEntry{
			Surface: StreamSurfaceREST,
			Name:    operation.Method + " " + operation.Path,
			Kind:    kind,
			Module:  ModuleFor(repoRoot, operation.Method, operation.Path),
			Detail:  detail,
		}
		if err := stream.Append(entry); err != nil {
			fmt.Fprintf(stderr, "findings stream: %v\n", err)
		}
	}
}

// ModuleFor names the catalog module that owns one REST operation: the
// module whose transport declares the route literally, else the module whose
// router declares the path's namespace, else a feature id or subject the path
// names. Empty when nothing matches or repoRoot has no modules/ directory.
func ModuleFor(repoRoot, method, path string) string {
	index := loadModuleIndex(repoRoot)
	if index == nil {
		return ""
	}
	key := routeShape(path)
	if module := index.routes[strings.ToUpper(method)+" "+key]; module != "" {
		return module
	}
	if module := index.paths[key]; module != "" {
		return module
	}
	for _, segment := range pathSegments(path) {
		if module := index.names[segment]; module != "" {
			return module
		}
		if module := index.restNamespaces[segment]; module != "" {
			return module
		}
		if module, ok := matchModule(segment, index.names); ok {
			return module
		}
	}
	return ""
}

// ModuleForNamespace names the catalog module that declares one tRPC
// namespace (defineTrpcContract in its contract), trying each dotted parent
// of a nested namespace before falling back to feature ids and subjects.
func ModuleForNamespace(repoRoot, namespace string) string {
	index := loadModuleIndex(repoRoot)
	if index == nil {
		return ""
	}
	for candidate := namespace; candidate != ""; candidate = dottedParent(candidate) {
		if module := index.trpcNamespaces[candidate]; module != "" {
			return module
		}
	}
	for _, part := range strings.Split(namespace, ".") {
		if module, ok := matchModule(kebabCase(part), index.names); ok {
			return module
		}
	}
	return ""
}

// ModuleNamed is the catalog module whose id or subject is exactly name,
// kebab-cased. An exact name outranks every prefix heuristic (parity rulings,
// 2026-09-25): identityLookup's leading word is the identity module.
func ModuleNamed(repoRoot, name string) string {
	index := loadModuleIndex(repoRoot)
	if index == nil || name == "" {
		return ""
	}
	return index.names[kebabCase(name)]
}

func dottedParent(namespace string) string {
	position := strings.LastIndex(namespace, ".")
	if position < 0 {
		return ""
	}
	return namespace[:position]
}

func kebabCase(word string) string {
	var out strings.Builder
	for position, char := range word {
		if char >= 'A' && char <= 'Z' {
			if position > 0 {
				out.WriteByte('-')
			}
			out.WriteRune(char + ('a' - 'A'))
			continue
		}
		out.WriteRune(char)
	}
	return out.String()
}

func pathSegments(path string) []string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return nil
	}
	var out []string
	for _, segment := range strings.Split(trimmed, "/") {
		switch {
		case segment == "api":
		case len(segment) >= 2 && segment[0] == 'v' && allDigits(segment[1:]):
		case isVersionSegment(segment):
		case strings.HasPrefix(segment, "{"):
		default:
			out = append(out, segment)
		}
	}
	return out
}

func matchModule(segment string, modules map[string]string) (string, bool) {
	for _, candidate := range []string{segment, strings.TrimSuffix(segment, "s"), segment + "s"} {
		if module, ok := modules[candidate]; ok {
			return module, true
		}
	}
	return "", false
}

// routeShape reduces a path to its parameter-blind shape, so an OpenAPI
// "/api/prompts/{id}" and a declared "/api/prompts/:id{.+?}" compare equal.
func routeShape(path string) string {
	segments := strings.Split(strings.TrimSuffix(path, "/"), "/")
	for position, segment := range segments {
		if strings.HasPrefix(segment, ":") || strings.HasPrefix(segment, "{") {
			segments[position] = "{}"
		}
	}
	return strings.Join(segments, "/")
}

// moduleIndex is everything the branch's own source says about which module
// serves what, read once per repository root.
type moduleIndex struct {
	routes         map[string]string // "METHOD /api/x/{}" -> module
	paths          map[string]string // "/api/x/{}" -> module
	restNamespaces map[string]string
	trpcNamespaces map[string]string
	names          map[string]string // feature ids and subjects -> module
}

// moduleCatalogFile is the one map of subjects to owning modules.
const moduleCatalogFile = "catalogue.json"

type catalogueFeature struct {
	ID       string   `json:"id"`
	Root     string   `json:"root"`
	Subjects []string `json:"subjects"`
}

var (
	moduleIndexes   = map[string]*moduleIndex{}
	moduleIndexLock sync.Mutex
)

var (
	restRouteLiteral  = regexp.MustCompile(`\.(get|post|put|patch|delete)\(\s*"(/api/[^"]*)"`)
	restNamespaceDecl = regexp.MustCompile(`withNamespace\(\s*"([^"]+)"`)
	trpcNamespaceDecl = regexp.MustCompile(`defineTrpcContract\(\s*"([^"]+)"`)
)

func loadModuleIndex(repoRoot string) *moduleIndex {
	if repoRoot == "" {
		return nil
	}
	moduleIndexLock.Lock()
	defer moduleIndexLock.Unlock()
	if index, ok := moduleIndexes[repoRoot]; ok {
		return index
	}
	index := buildModuleIndex(repoRoot)
	moduleIndexes[repoRoot] = index
	return index
}

// buildModuleIndex reads the modules/ catalog file, then each feature's REST
// transports and contract sources. Without a catalog it falls back to the
// directory names under modules/, and without either it answers nil.
func buildModuleIndex(repoRoot string) *moduleIndex {
	features := readCatalogue(repoRoot)
	if len(features) == 0 {
		return nil
	}
	index := &moduleIndex{
		routes: map[string]string{}, paths: map[string]string{},
		restNamespaces: map[string]string{}, trpcNamespaces: map[string]string{},
		names: map[string]string{},
	}
	for _, feature := range features {
		index.names[feature.ID] = feature.ID
		for _, subject := range feature.Subjects {
			if _, taken := index.names[subject]; !taken {
				index.names[subject] = feature.ID
			}
		}
		root := filepath.Join(repoRoot, filepath.FromSlash(feature.Root))
		index.readRestTransports(feature.ID, filepath.Join(root, "process", "src", "transport"))
		index.readTrpcContracts(feature.ID, filepath.Join(root, "contract", "src"))
	}
	return index
}

func readCatalogue(repoRoot string) []catalogueFeature {
	// #nosec G304 -- the catalog path is fixed under the operator's checkout.
	data, err := os.ReadFile(filepath.Join(repoRoot, "modules", moduleCatalogFile))
	if err == nil {
		var catalog struct {
			Features []catalogueFeature `json:"features"`
		}
		if json.Unmarshal(data, &catalog) == nil && len(catalog.Features) > 0 {
			return catalog.Features
		}
	}
	entries, err := os.ReadDir(filepath.Join(repoRoot, "modules"))
	if err != nil {
		return nil
	}
	var features []catalogueFeature
	for _, entry := range entries {
		if entry.IsDir() {
			features = append(features, catalogueFeature{ID: entry.Name(), Root: "modules/" + entry.Name()})
		}
	}
	return features
}

func (index *moduleIndex) readRestTransports(module, dir string) {
	files, _ := filepath.Glob(filepath.Join(dir, "*.rest.ts"))
	for _, file := range files {
		source := readSource(file)
		for _, match := range restRouteLiteral.FindAllStringSubmatch(source, -1) {
			shape := routeShape(match[2])
			claim(index.routes, strings.ToUpper(match[1])+" "+shape, module)
			claim(index.paths, shape, module)
		}
		for _, match := range restNamespaceDecl.FindAllStringSubmatch(source, -1) {
			claim(index.restNamespaces, match[1], module)
		}
	}
}

func (index *moduleIndex) readTrpcContracts(module, dir string) {
	_ = filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return skipNonSource(entry.Name())
		}
		if strings.HasSuffix(path, ".ts") {
			index.claimTrpcNamespaces(module, readSource(path))
		}
		return nil
	})
}

func skipNonSource(dirName string) error {
	if dirName == "__tests__" || dirName == "node_modules" {
		return filepath.SkipDir
	}
	return nil
}

func (index *moduleIndex) claimTrpcNamespaces(module, source string) {
	for _, match := range trpcNamespaceDecl.FindAllStringSubmatch(source, -1) {
		claim(index.trpcNamespaces, match[1], module)
	}
}

// claim records the first module to declare a key; catalog order decides a
// collision, and the tree has none today.
func claim(into map[string]string, key, module string) {
	if _, taken := into[key]; !taken {
		into[key] = module
	}
}

func readSource(path string) string {
	data, err := os.ReadFile(path) // #nosec G304 -- a transport or contract file under the catalogue's own roots.
	if err != nil {
		return ""
	}
	return string(data)
}

// moduleRoot is the checkout whose catalog maps operations to modules: the
// run's branch, or for `probe` the nearest ancestor of the working directory
// that has a modules/ catalog file.
func (probe *probeFlags) moduleRoot() string {
	if probe.repoRoot != "" {
		return probe.repoRoot
	}
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "modules", moduleCatalogFile)); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func (probe *probeFlags) moduleOf() func(method, path string) string {
	root := probe.moduleRoot()
	return func(method, path string) string { return ModuleFor(root, method, path) }
}

// scopeToModules applies -module: only the named modules' operations and
// their parameter producers are probed and ledgered.
func (probe *probeFlags) scopeToModules(union []Operation, out streams) int {
	if len(probe.modules) == 0 {
		return exitEqual
	}
	only, producers, err := ScopeToModules(union, probe.modules, probe.moduleOf())
	if err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	probe.only = only
	fmt.Fprintf(out.stderr, "module scope %s: %d operations, %d of them parameter producers outside the scope\n",
		strings.Join(probe.modules, ", "), len(only), producers)
	return exitEqual
}

func (probe *probeFlags) ledgerOptions(baseline map[string]bool) LedgerOptions {
	return LedgerOptions{
		Baseline: baseline,
		Scope:    LedgerScope{Modules: []string(probe.modules), ModuleOf: probe.moduleOf(), Only: probe.only},
	}
}

// writeModulePackets writes <work-root>/probe/<module>.md for `run`, or a
// probe/ directory beside -report for `probe`; nothing when neither exists.
func (probe *probeFlags) writeModulePackets(verdict runVerdict, out streams) {
	dir := probe.packetDir
	if dir == "" && probe.reportFile != "" {
		dir = filepath.Join(filepath.Dir(probe.reportFile), "probe")
	}
	if dir == "" {
		return
	}
	written, err := WriteModulePackets(dir, verdict.ledger, verdict.report)
	if err != nil {
		fmt.Fprintln(out.stderr, "module packets:", err)
		return
	}
	fmt.Fprintf(out.stderr, "module packets: %d in %s\n", len(written), dir)
}
