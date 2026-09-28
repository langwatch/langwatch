package apidiff

import (
	"slices"
	"strings"
)

// ServedGap is one route main serves that the branch does not.
type ServedGap struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Source string `json:"source"`
	Module string `json:"module"`
}

// IgnoredRoute is one main route the served comparison does not judge, and why.
type IgnoredRoute struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

// ServedParity is every route main's HTTP application serves against every
// route the branch's api process serves: what REST parity cannot see, because
// main never documented it.
type ServedParity struct {
	MainCount   int            `json:"mainCount"`
	BranchCount int            `json:"branchCount"`
	Missing     []ServedGap    `json:"missingOnBranch"`
	Retired     []ServedGap    `json:"ruledRetired"`
	Ignored     []IgnoredRoute `json:"ignored"`
}

// ServedComparison is what the served comparison needs besides the routes:
// the METHOD route keys main's OpenAPI document describes, and the module
// owning a METHOD path in its OpenAPI spelling.
type ServedComparison struct {
	Documented map[string]bool
	ModuleOf   func(method, path string) string
}

const (
	ignoreBetterAuth   = "Better Auth's catch-all: every path under it is the library's own router, not a LangWatch route"
	ignoreTrpcLanes    = "tRPC lane: compared procedure by procedure in the tRPC section"
	ignoreVersionMount = "URL version mount: versioning is negotiated through X-API-Version, so no client is built against the mount"
	ignoreDocumented   = "documented on main: REST parity compares it operation by operation"
)

// servedIgnores are the framework routes the comparison does not judge, in
// the order they are tried; each names its reason.
var servedIgnores = []struct {
	reason  string
	matches func(path string) bool
}{
	{ignoreBetterAuth, func(path string) bool { return path == "/api/auth/*" }},
	{ignoreTrpcLanes, func(path string) bool { return path == "/api/trpc/*" || path == "/api/sse/*" }},
	{ignoreVersionMount, versionMountRoute},
	{ignoreServedLiterally, func(path string) bool { return servedLiterally[path] }},
}

// ignoreServedLiterally names main routes whose wildcard or parameter the
// branch answers route by route instead.
const ignoreServedLiterally = "main's wildcard or parameter route is served one route per operation on the branch"

// servedLiterally: main's /api/evaluations/v3/* only forwarded to its v3 app,
// which experiment-v3-legacy.rest.ts serves route for route; main's gateway
// connect dispatch table has exactly instant-evals-classify, usage and budget,
// which licensing's connect-hosted.rest.ts serves as literal routes.
var servedLiterally = map[string]bool{
	"/api/evaluations/v3/*":                     true,
	"/api/internal/gateway/connect/:operation":  true,
	"/api/internal/gateway/connect/{operation}": true,
}

func ignoreReason(path string) string {
	canonical := CanonicalAliasPath(path)
	for _, ignore := range servedIgnores {
		if ignore.matches(canonical) {
			return ignore.reason
		}
	}
	return ""
}

// DocumentedRoutes is the METHOD route key of every operation a served
// document describes.
func DocumentedRoutes(document map[string]any) map[string]bool {
	documented := map[string]bool{}
	operations, err := Operations(document)
	if err != nil {
		return documented
	}
	for index := range operations {
		documented[strings.ToUpper(operations[index].Method)+" "+routeKey(operations[index].Path)] = true
	}
	return documented
}

// DiffServedRoutes files each distinct main route as ignored, served by the
// branch, ruled retired, left to REST parity, or missing on the branch.
func DiffServedRoutes(main, branch []ServedRoute, comparison ServedComparison) ServedParity {
	index := indexServed(branch)
	diff := servedDiff{comparison: comparison, branch: index, seen: map[string]bool{}}
	diff.parity = ServedParity{BranchCount: index.count, Missing: []ServedGap{}, Retired: []ServedGap{}, Ignored: []IgnoredRoute{}}
	for _, route := range main {
		diff.file(route)
	}
	return diff.parity
}

type servedDiff struct {
	comparison ServedComparison
	branch     servedIndex
	seen       map[string]bool
	parity     ServedParity
}

func (diff *servedDiff) file(route ServedRoute) {
	key := routeKey(route.Path)
	if diff.seen[route.Method+" "+key] {
		return
	}
	diff.seen[route.Method+" "+key] = true
	diff.parity.MainCount++
	if reason := ignoreReason(route.Path); reason != "" {
		diff.parity.Ignored = append(diff.parity.Ignored, IgnoredRoute{Method: route.Method, Path: route.Path, Reason: reason})
		return
	}
	if diff.branch.covers(route.Method, key) {
		return
	}
	path := CanonicalAliasPath(openAPIPath(route.Path))
	gap := ServedGap{Method: route.Method, Path: route.Path, Source: route.Source, Module: diff.comparison.ModuleOf(route.Method, path)}
	switch {
	case RetiredRestOperation(path):
		diff.parity.Retired = append(diff.parity.Retired, gap)
	case diff.comparison.Documented[route.Method+" "+key]:
		diff.parity.Ignored = append(diff.parity.Ignored, IgnoredRoute{Method: route.Method, Path: route.Path, Reason: ignoreDocumented})
	default:
		diff.parity.Missing = append(diff.parity.Missing, gap)
	}
}

// servedIndex is the branch's routes by METHOD key, and its wildcard routes
// by the prefix they answer under.
type servedIndex struct {
	exact     map[string]bool
	paths     map[string]bool
	wildcards []servedWildcard
	count     int
}

type servedWildcard struct {
	method string
	prefix string
}

func indexServed(routes []ServedRoute) servedIndex {
	index := servedIndex{exact: map[string]bool{}, paths: map[string]bool{}}
	for _, route := range routes {
		key := routeKey(route.Path)
		if index.exact[route.Method+" "+key] {
			continue
		}
		index.exact[route.Method+" "+key] = true
		index.paths[key] = true
		index.count++
		if prefix, found := strings.CutSuffix(key, "*"); found {
			index.wildcards = append(index.wildcards, servedWildcard{method: route.Method, prefix: prefix})
		}
	}
	return index
}

// covers says whether the branch answers a main METHOD key: the same route,
// an any-method route, GET for a HEAD, or a wildcard the key falls under. A
// main ALL is covered by any declared method there: the framework's method
// guard answers the rest with 405, as main's catch-all did.
func (index servedIndex) covers(method, key string) bool {
	if method == "ALL" && index.paths[key] {
		return true
	}
	methods := coveringMethods(method)
	for _, candidate := range methods {
		if index.exact[candidate+" "+key] {
			return true
		}
	}
	for _, wildcard := range index.wildcards {
		if strings.HasPrefix(key, wildcard.prefix) && slices.Contains(methods, wildcard.method) {
			return true
		}
	}
	return false
}

func coveringMethods(method string) []string {
	if method == "HEAD" {
		return []string{method, "ALL", "GET"}
	}
	return []string{method, "ALL"}
}

// routeSegments is a route's canonical alias form, split, with a trailing
// slash dropped: Hono serves "/llms.txt/" only because it was registered.
func routeSegments(path string) []string {
	canonical := CanonicalAliasPath(path)
	if len(canonical) > 1 {
		canonical = strings.TrimSuffix(canonical, "/")
	}
	return strings.Split(canonical, "/")
}

// parameterName is a path segment's parameter name in either spelling
// (":id", ":id?", ":id{.+}", "{id}"), and whether it is one.
func parameterName(segment string) (string, bool) {
	if strings.HasPrefix(segment, "{") && strings.HasSuffix(segment, "}") {
		return segment[1 : len(segment)-1], true
	}
	if !strings.HasPrefix(segment, ":") {
		return "", false
	}
	name := segment[1:]
	if end := strings.IndexAny(name, "{?"); end >= 0 {
		name = name[:end]
	}
	return name, true
}

// routeKey is a route's identity across both routers: canonical alias form,
// parameter names erased (PairingPath's rule), regex constraints dropped.
func routeKey(path string) string {
	segments := routeSegments(path)
	for position, segment := range segments {
		if _, ok := parameterName(segment); ok {
			segments[position] = "{}"
		}
	}
	return strings.Join(segments, "/")
}

// openAPIPath is a route in the OpenAPI spelling the module lookup and the
// retirement rulings read: ":id{.+}" becomes "{id}".
func openAPIPath(path string) string {
	segments := routeSegments(path)
	for position, segment := range segments {
		if name, ok := parameterName(segment); ok {
			segments[position] = "{" + name + "}"
		}
	}
	return strings.Join(segments, "/")
}

// versionMountRoute reports a route registered for a URL version mount: a
// "latest" or dated segment anywhere under /api (a two-segment family such as
// langy/control mounts its versions deeper than VersionMountPath looks), or
// the version fallback parameter that answers "latest|preview|<date>".
func versionMountRoute(path string) bool {
	segments := routeSegments(path)
	if len(segments) < 3 || segments[1] != "api" {
		return false
	}
	for _, segment := range segments[2:] {
		if segment == "latest" || dateVersionSegment(segment) {
			return true
		}
		if strings.HasPrefix(segment, ":") && strings.Contains(segment, "{latest|") {
			return true
		}
	}
	return false
}
