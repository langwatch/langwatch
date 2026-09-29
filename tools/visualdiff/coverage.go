package visualdiff

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"sort"
	"strings"
)

// CoverageConfig names where each ref declares its screens, and the routes
// deliberately left out of the capture with the reason why.
type CoverageConfig struct {
	// BasePages is the base's file-routed pages directory (main's Next.js pages).
	BasePages string `yaml:"basePages"`
	// CandidateScreens are the pathspecs whose "pages/..." screen keys are
	// the candidate's route declarations (default: every *.web.ts(x)).
	CandidateScreens []string    `yaml:"candidateScreens"`
	Excluded         []Exclusion `yaml:"excluded"`
}

// Exclusion is one route pattern visualdiff does not render, and why. A
// pattern ending in /** excludes everything under it.
type Exclusion struct {
	Route  string `yaml:"route"`
	Reason string `yaml:"reason"`
}

var defaultCandidateScreens = []string{"*.web.ts", "*.web.tsx", ":!**/__tests__/**"}

// Coverage statuses.
const (
	CoverageCovered   = "covered"
	CoverageExcluded  = "excluded"
	CoverageUncovered = "uncovered"
)

// CoverageEntry is one route pattern either ref declares.
type CoverageEntry struct {
	Pattern string   `json:"pattern"`
	Sources []string `json:"sources"`
	Status  string   `json:"status"`
	Reason  string   `json:"reason,omitempty"`
}

// Dynamic reports a pattern with a parameter other than the project slug.
func (entry CoverageEntry) Dynamic() bool {
	return strings.Contains(strings.ReplaceAll(entry.Pattern, "{slug}", ""), "{")
}

// Coverage is every declared route against visualdiff.yaml. Stale are the
// configured routes neither ref declares.
type Coverage struct {
	Entries []CoverageEntry `json:"entries"`
	Stale   []string        `json:"stale,omitempty"`
}

// Count is covered over everything not excluded.
func (coverage Coverage) Count() (covered, total int) {
	for _, entry := range coverage.Entries {
		switch entry.Status {
		case CoverageCovered:
			covered++
			total++
		case CoverageUncovered:
			total++
		}
	}
	return covered, total
}

// Uncovered are the entries neither rendered nor excluded.
func (coverage Coverage) Uncovered() []CoverageEntry {
	var out []CoverageEntry
	for _, entry := range coverage.Entries {
		if entry.Status == CoverageUncovered {
			out = append(out, entry)
		}
	}
	return out
}

// Line is the one-line verdict: `coverage 140/170 (17 excluded, 30 uncovered)`.
func (coverage Coverage) Line() string {
	covered, total := coverage.Count()
	return fmt.Sprintf("coverage %d/%d (%d excluded, %d uncovered)",
		covered, total, len(coverage.Entries)-total, total-covered)
}

// PagePattern turns a file under a pages directory into its route pattern,
// or reports false for a file that is not a page (tests, helpers, styles).
func PagePattern(relative string) (string, bool) {
	if !strings.HasSuffix(relative, ".tsx") && !strings.HasSuffix(relative, ".jsx") {
		return "", false
	}
	segments := strings.Split(strings.TrimSuffix(strings.TrimSuffix(relative, ".tsx"), ".jsx"), "/")
	name := segments[len(segments)-1]
	if segments[0] == "api" || name == "" || (strings.Contains(name, ".") && !strings.HasPrefix(name, "[")) ||
		strings.HasPrefix(name, "_") || strings.ToLower(name[:1]) != name[:1] {
		return "", false
	}
	for _, segment := range segments {
		if segment == "__tests__" {
			return "", false
		}
	}
	return routeFromSegments(segments), true
}

// ScreenPattern turns a candidate screen key ("pages/[project]/datasets") into its pattern.
func ScreenPattern(key string) (string, bool) {
	relative, found := strings.CutPrefix(key, "pages/")
	if !found || relative == "" {
		return "", false
	}
	return routeFromSegments(strings.Split(relative, "/")), true
}

// routeFromSegments writes a pages path as a pattern: [project] is {slug},
// [x] is {x}, [...x] is {...x}, [[...x]] and a trailing index are the parent.
func routeFromSegments(segments []string) string {
	out := make([]string, 0, len(segments))
	for index, segment := range segments {
		switch {
		case segment == "index" && index == len(segments)-1:
		case strings.HasPrefix(segment, "[[..."):
		case segment == "[project]":
			out = append(out, "{slug}")
		case strings.HasPrefix(segment, "[") && strings.HasSuffix(segment, "]"):
			out = append(out, parameter(strings.TrimSuffix(strings.TrimPrefix(segment, "["), "]")))
		default:
			out = append(out, segment)
		}
	}
	return "/" + strings.Join(out, "/")
}

// parameter writes a route parameter as {name}. A parameter called slug is
// renamed, since {slug} is the project a run signs in to.
func parameter(name string) string {
	if name == "slug" {
		return "{entitySlug}"
	}
	return "{" + name + "}"
}

// PatternCovers reports whether a configured route renders a pattern: every
// literal segment equal, every parameter answered by some segment, a
// catch-all by one or more.
func PatternCovers(pattern, route string) bool {
	route, _, _ = strings.Cut(route, "?")
	patternSegments, routeSegments := splitPath(pattern), splitPath(route)
	for index, segment := range patternSegments {
		if strings.HasPrefix(segment, "{...") {
			return len(routeSegments) > index
		}
		if index >= len(routeSegments) {
			return false
		}
		if isParameter(segment) {
			continue
		}
		if segment != routeSegments[index] {
			return false
		}
	}
	return len(patternSegments) == len(routeSegments)
}

func isParameter(segment string) bool {
	return segment != "{slug}" && strings.HasPrefix(segment, "{") && strings.HasSuffix(segment, "}")
}

func splitPath(path string) []string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "/")
}

// excludedBy returns the exclusion that names a pattern, if any.
func excludedBy(pattern string, exclusions []Exclusion) (Exclusion, bool) {
	for _, exclusion := range exclusions {
		prefix, wildcard := strings.CutSuffix(exclusion.Route, "/**")
		if exclusion.Route == pattern || (wildcard && (pattern == prefix || strings.HasPrefix(pattern, prefix+"/"))) {
			return exclusion, true
		}
	}
	return Exclusion{}, false
}

// CoverageInputs are the two refs' declared patterns and the configuration.
type CoverageInputs struct {
	Base      []string
	Candidate []string
	Routes    []string
	Excluded  []Exclusion
}

// ComputeCoverage decides every pattern either ref declares.
func ComputeCoverage(inputs CoverageInputs) Coverage {
	sources := map[string][]string{}
	for _, pattern := range inputs.Base {
		sources[pattern] = appendOnce(sources[pattern], "base")
	}
	for _, pattern := range inputs.Candidate {
		sources[pattern] = appendOnce(sources[pattern], "candidate")
	}
	patterns := make([]string, 0, len(sources))
	for pattern := range sources {
		patterns = append(patterns, pattern)
	}
	sort.Strings(patterns)
	coverage := Coverage{}
	used := map[string]bool{}
	for _, pattern := range patterns {
		entry := decideCoverage(pattern, inputs)
		entry.Sources = sources[pattern]
		if route, ok := coveringRoute(pattern, inputs.Routes); ok {
			used[route] = true
		}
		coverage.Entries = append(coverage.Entries, entry)
	}
	for _, route := range inputs.Routes {
		if !used[route] && !coversAny(route, patterns) {
			coverage.Stale = append(coverage.Stale, route)
		}
	}
	return coverage
}

// decideCoverage is one pattern's status: rendered wins over excluded.
func decideCoverage(pattern string, inputs CoverageInputs) CoverageEntry {
	entry := CoverageEntry{Pattern: pattern, Status: CoverageUncovered}
	if _, ok := coveringRoute(pattern, inputs.Routes); ok {
		entry.Status = CoverageCovered
	} else if exclusion, ok := excludedBy(pattern, inputs.Excluded); ok {
		entry.Status, entry.Reason = CoverageExcluded, exclusion.Reason
	}
	return entry
}

func coveringRoute(pattern string, routes []string) (string, bool) {
	for _, route := range routes {
		if PatternCovers(pattern, route) {
			return route, true
		}
	}
	return "", false
}

func coversAny(route string, patterns []string) bool {
	for _, pattern := range patterns {
		if PatternCovers(pattern, route) {
			return true
		}
	}
	return false
}

func appendOnce(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

// coverageSource reads one ref's declarations through git, so neither ref
// needs a checkout.
type coverageSource struct {
	run  runner
	root string
}

// basePatterns lists the base's pages directory at ref as patterns.
func (source coverageSource) basePatterns(ctx context.Context, ref, dir string) ([]string, error) {
	var out bytes.Buffer
	spec := commandSpec{name: "git", args: []string{"ls-tree", "-r", "--name-only", ref, "--", dir}, dir: source.root}
	if err := source.run(ctx, spec, &out); err != nil {
		return nil, fmt.Errorf("list %s pages at %s: %w", dir, ref, err)
	}
	var patterns []string
	for _, line := range strings.Split(out.String(), "\n") {
		relative, found := strings.CutPrefix(strings.TrimSpace(line), strings.TrimSuffix(dir, "/")+"/")
		if !found {
			continue
		}
		if pattern, ok := PagePattern(relative); ok {
			patterns = append(patterns, pattern)
		}
	}
	return patterns, nil
}

// noMatches is git grep's exit status 1: it ran and found nothing.
func noMatches(err error) bool {
	var exit *exec.ExitError
	return errors.As(err, &exit) && exit.ExitCode() == 1
}

var (
	screenKey  = regexp.MustCompile(`"(pages/[^"]+)"\s*:`)
	screenPath = regexp.MustCompile(`^\s*path:\s*"([^"]+)"`)
)

// candidatePatterns lists the candidate's screens at ref: each "pages/..."
// screen key, or the path: the screen declares under it, which wins.
func (source coverageSource) candidatePatterns(ctx context.Context, ref string, pathspecs []string) ([]string, error) {
	var out bytes.Buffer
	pattern := `"pages/[^"]+"[[:space:]]*:|^[[:space:]]*path:[[:space:]]*"/`
	args := append([]string{"grep", "-z", "-E", pattern, ref, "--"}, pathspecs...)
	if err := source.run(ctx, commandSpec{name: "git", args: args, dir: source.root}, &out); err != nil && !noMatches(err) {
		return nil, fmt.Errorf("list screen declarations at %s: %w", ref, err)
	}
	return ParseScreenDeclarations(out.String()), nil
}

// ParseScreenDeclarations reads `git grep -z` lines (file NUL line NUL text)
// in file order: a key is the pattern unless a path: follows it in the same file.
func ParseScreenDeclarations(output string) []string {
	parser := &declarationParser{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.SplitN(line, "\x00", 3)
		if len(fields) >= 2 {
			parser.read(fields[0], fields[len(fields)-1])
		}
	}
	parser.flush()
	return parser.patterns
}

// declarationParser holds the screen key still waiting for its path:.
type declarationParser struct {
	patterns []string
	pending  string
	file     string
}

func (parser *declarationParser) read(file, text string) {
	if file != parser.file {
		parser.flush()
		parser.file = file
	}
	if match := screenKey.FindStringSubmatch(text); match != nil {
		parser.flush()
		parser.pending = match[1]
		return
	}
	if match := screenPath.FindStringSubmatch(text); match != nil {
		parser.pending = ""
		parser.patterns = append(parser.patterns, RouterPathPattern(match[1]))
	}
}

func (parser *declarationParser) flush() {
	if converted, ok := ScreenPattern(parser.pending); ok {
		parser.patterns = append(parser.patterns, converted)
	}
	parser.pending = ""
}

// RouterPathPattern writes a router path ("/:project/datasets/:id") as a
// pattern ("/{slug}/datasets/{id}").
func RouterPathPattern(path string) string {
	segments := splitPath(path)
	for index, segment := range segments {
		switch {
		case segment == ":project":
			segments[index] = "{slug}"
		case strings.HasPrefix(segment, ":"):
			segments[index] = parameter(strings.TrimSuffix(strings.TrimPrefix(segment, ":"), "?"))
		case segment == "*":
			segments[index] = "{...path}"
		}
	}
	return "/" + strings.Join(segments, "/")
}

// coverageRequest is one coverage computation between two refs.
type coverageRequest struct {
	run          runner
	root         string
	baseRef      string
	candidateRef string
	config       *Config
}

// ResolveCoverage reads both refs' declarations and decides every pattern.
// A configuration without a coverage section is refused: silence here is
// exactly how screens went unrendered before.
func ResolveCoverage(ctx context.Context, request coverageRequest) (Coverage, error) {
	settings := request.config.Coverage
	if settings.BasePages == "" {
		return Coverage{}, fmt.Errorf("visualdiff.yaml names no coverage.basePages")
	}
	pathspecs := settings.CandidateScreens
	if len(pathspecs) == 0 {
		pathspecs = defaultCandidateScreens
	}
	source := coverageSource{run: request.run, root: request.root}
	base, err := source.basePatterns(ctx, request.baseRef, settings.BasePages)
	if err != nil {
		return Coverage{}, err
	}
	candidate, err := source.candidatePatterns(ctx, request.candidateRef, pathspecs)
	if err != nil {
		return Coverage{}, err
	}
	if len(base)+len(candidate) == 0 {
		return Coverage{}, fmt.Errorf("neither %s under %s nor %s's screens declare a route", request.baseRef, settings.BasePages, request.candidateRef)
	}
	return ComputeCoverage(CoverageInputs{
		Base: base, Candidate: candidate, Routes: request.config.DeclaredRoutes(), Excluded: settings.Excluded,
	}), nil
}

// WriteCoverage prints the verdict line, then every uncovered pattern with
// the refs that declare it, then the configured routes nothing declares.
func WriteCoverage(out io.Writer, coverage Coverage) {
	fmt.Fprintln(out, coverage.Line())
	for _, entry := range coverage.Uncovered() {
		fmt.Fprintf(out, "  uncovered %s (%s)\n", entry.Pattern, strings.Join(entry.Sources, "+"))
	}
	for _, route := range coverage.Stale {
		fmt.Fprintf(out, "  stale route %s: neither ref declares it\n", route)
	}
}
