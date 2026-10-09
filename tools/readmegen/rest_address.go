package readmegen

import (
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
)

// The Go port of packages/api/src/rest/addressing.ts (basePathOf, addressesOf,
// canonicalV1Path) and of hono's mergePath, which runtime.ts mounts with.
const v1Prefix = "/api/v1"

var versionSegment = regexp.MustCompile(`^v\d+$`)

func basePathOf(family *RestFamily) string {
	namespace := family.Namespace.Value
	switch family.Addressing {
	case "v1-only":
		return v1Prefix + "/" + namespace
	case "v1-in-path":
		return "/api/" + namespace + "/" + family.Generation
	case "literal":
		return ""
	default:
		return "/api/" + namespace
	}
}

func canonicalV1Path(path string) string {
	if path != "/api" && !strings.HasPrefix(path, "/api/") {
		return ""
	}
	rest := strings.TrimPrefix(path, "/api")
	if rest == "" || rest == "/" {
		return ""
	}
	for _, segment := range strings.Split(rest, "/") {
		if versionSegment.MatchString(segment) {
			return ""
		}
	}
	return v1Prefix + rest
}

func mergePath(base, sub string) string {
	lead := "/"
	if strings.HasPrefix(base, "/") {
		lead = ""
	}
	if sub == "/" {
		return lead + base
	}
	join := "/"
	if strings.HasSuffix(base, "/") {
		join = ""
	}
	return lead + base + join + strings.TrimPrefix(sub, "/")
}

// restAddress is one path a route answers at; alias is its /api/v1 twin.
type restAddress struct {
	path, alias string
	documented  bool
}

func addressesOf(route *RestRoute, family *RestFamily) []restAddress {
	suffix := route.Path.Value
	if suffix == "/" {
		suffix = ""
	}
	relative := []struct {
		path       string
		documented bool
	}{{orSlash(suffix), true}}
	if family.Addressing == "dated" {
		relative = append([]struct {
			path       string
			documented bool
		}{{"/" + family.Version.Value + suffix, false}, {"/latest" + suffix, false}}, relative...)
	}
	base := basePathOf(family)
	addresses := make([]restAddress, 0, len(relative))
	for _, item := range relative {
		absolute := item.path
		if base != "" {
			absolute = mergePath(base, item.path)
		}
		address := restAddress{path: absolute, documented: item.documented}
		if family.V1Twin {
			address.alias = canonicalV1Path(absolute)
		}
		addresses = append(addresses, address)
	}
	return addresses
}

func orSlash(path string) string {
	if path == "" {
		return "/"
	}
	return path
}

func routeMethods(route *RestRoute) []string {
	switch {
	case route.AnyMethod:
		return []string{"ALL"}
	case len(route.Methods) > 0:
		return route.Methods
	default:
		return []string{route.Method}
	}
}

// familyResolved reports whether every value its addresses depend on was folded.
func familyResolved(family *RestFamily) bool {
	if !family.Namespace.Resolved || (family.Addressing == "dated" && !family.Version.Resolved) {
		return false
	}
	for index := range family.Routes {
		if !family.Routes[index].Path.Resolved {
			return false
		}
	}
	return true
}

// addressSets are the addresses read from the code and those mounted, by family.
type addressSets struct {
	read, mounted map[string]map[string]bool
	unread        map[string]bool
}

func (sets *addressSets) add(into map[string]map[string]bool, family, key string) {
	if into[family] == nil {
		into[family] = map[string]bool{}
	}
	into[family][key] = true
}

func (sets *addressSets) readFamily(family *RestFamily) {
	namespace := family.Namespace.Value
	if !familyResolved(family) {
		sets.unread[namespace] = true
		return
	}
	for index := range family.Routes {
		sets.readRoute(family, &family.Routes[index])
	}
}

func (sets *addressSets) readRoute(family *RestFamily, route *RestRoute) {
	for _, address := range addressesOf(route, family) {
		for _, method := range routeMethods(route) {
			sets.add(sets.read, family.Namespace.Value, method+" "+address.path)
			if address.alias != "" {
				sets.add(sets.read, family.Namespace.Value, method+" "+address.alias)
			}
		}
	}
}

// crossCheck compares the addresses read from the code with the api's mounted
// registry, family by family, and prints every disagreement. It returns their count.
func crossCheck(manifest Manifest, stderr io.Writer) int {
	if manifest.Mounted.Error != "" {
		fmt.Fprintf(stderr, "readmegen: REST cross-check skipped: the describe-only mount failed: %s\n", manifest.Mounted.Error)
		return 0
	}
	sets := &addressSets{read: map[string]map[string]bool{}, mounted: map[string]map[string]bool{}, unread: map[string]bool{}}
	for index := range manifest.Modules {
		rest := manifest.Modules[index].Process.Rest
		for inner := range rest {
			sets.readFamily(&rest[inner])
		}
	}
	for _, route := range manifest.Mounted.Routes {
		sets.add(sets.mounted, route.Family, route.Method+" "+route.Path)
		if route.CanonicalPath != "" {
			sets.add(sets.mounted, route.Family, route.Method+" "+route.CanonicalPath)
		}
	}
	return sets.report(stderr)
}

func (sets *addressSets) report(stderr io.Writer) int {
	families := map[string]bool{}
	for name := range sets.read {
		families[name] = true
	}
	for name := range sets.mounted {
		families[name] = !sets.unread[name]
	}
	names := make([]string, 0, len(families))
	for name, compared := range families {
		if compared {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	count := 0
	for _, name := range names {
		missing, extra := difference(sets.mounted[name], sets.read[name]), difference(sets.read[name], sets.mounted[name])
		if len(missing) == 0 && len(extra) == 0 {
			continue
		}
		count++
		fmt.Fprintf(stderr, "readmegen: REST %q: mounted but not read: %s; read but not mounted: %s\n",
			name, orDash(strings.Join(missing, ", ")), orDash(strings.Join(extra, ", ")))
	}
	return count
}

func difference(left, right map[string]bool) []string {
	var out []string
	for key := range left {
		if !right[key] {
			out = append(out, key)
		}
	}
	sort.Strings(out)
	return out
}
