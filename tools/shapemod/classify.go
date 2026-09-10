// Package shapemod moves modules/<m>/server/src/{ports,adapters} files onto
// the strict repository shape (repositories/{prisma,memory,clickhouse,redis}
// behind an interface, registered in a *-repositories.registry.ts), and finds
// dead legacy-transport files. Classification reads import lines and member
// names with regexp only — no TypeScript parser. tslsp-cli does the semantic
// move and rename.
package shapemod

import (
	"regexp"
	"strings"
)

// Tier names a repository backend, or Infrastructure for a file the codemod
// only reports on.
type Tier string

const (
	TierPrisma         Tier = "prisma"
	TierMemory         Tier = "memory"
	TierClickhouse     Tier = "clickhouse"
	TierRedis          Tier = "redis"
	TierInterface      Tier = "interface"
	TierInfrastructure Tier = "infrastructure"
)

// Classification is the verdict for one ports/adapters file.
type Classification struct {
	Tier   Tier
	Reason string
	// Symbol is the exported class/interface name the file declares, empty
	// when none was found.
	Symbol string
}

var (
	importFromRe   = regexp.MustCompile(`(?m)from\s+["']([^"']+)["']`)
	namedImportRe  = regexp.MustCompile(`(?m)^\s*import\s+(?:type\s+)?\{([^}]*)\}`)
	newMapRe       = regexp.MustCompile(`\bnew Map\s*[<(]`)
	classOrIfaceRe = regexp.MustCompile(`(?m)^\s*export\s+(?:default\s+)?(abstract\s+class|class|interface)\s+(\w+)`)
	methodNameRe   = regexp.MustCompile(`(?m)^\s*(?:abstract\s+)?(?:public\s+|private\s+|protected\s+|readonly\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(`)
)

// repositoryVerbs are the method-name prefixes that mark an interface or
// abstract class as a repository rather than a technical port.
var repositoryVerbs = []string{"find", "create", "update", "delete", "list", "save", "upsert"}

// Classify inspects one ports/adapters file's source and returns its target
// tier. Order matters: prisma, then in-memory, then clickhouse/redis, then a
// repository-shaped interface, then everything else as infrastructure.
func Classify(content string) Classification {
	imports := importSpecifiers(content)
	symbol, kind := exportedSymbol(content)

	if importsPrisma(content, imports) {
		return Classification{Tier: TierPrisma, Reason: "imports PrismaRepository or @langwatch/prisma-client", Symbol: symbol}
	}

	// A class whose exported name says Redis or ClickHouse belongs to that
	// tier whatever it imports: a hand-rolled client interface is still a
	// datastore, and a Map inside it is a cache, not the store.
	if strings.HasPrefix(symbol, "Redis") {
		return Classification{Tier: TierRedis, Reason: "exported symbol is Redis-prefixed", Symbol: symbol}
	}
	if strings.HasPrefix(symbol, "ClickHouse") || strings.HasPrefix(symbol, "Clickhouse") {
		return Classification{Tier: TierClickHouse, Reason: "exported symbol is ClickHouse-prefixed", Symbol: symbol}
	}

	if newMapRe.MatchString(content) && !hasDatastoreImport(imports) {
		return Classification{Tier: TierMemory, Reason: "holds new Map( and imports no datastore client", Symbol: symbol}
	}

	if tier, spec := datastoreTier(imports); tier != "" {
		return Classification{Tier: tier, Reason: "imports a " + string(tier) + " client (" + spec + ")", Symbol: symbol}
	}

	if kind == "interface" || kind == "abstract class" {
		if verb, ok := repositoryShapedMembers(content); ok {
			return Classification{Tier: TierInterface, Reason: "interface/abstract class member " + verb + "(...) is repository-shaped", Symbol: symbol}
		}
	}

	return Classification{Tier: TierInfrastructure, Reason: "no datastore import, no repository-shaped member", Symbol: symbol}
}

func importSpecifiers(content string) []string {
	matches := importFromRe.FindAllStringSubmatch(content, -1)
	specs := make([]string, 0, len(matches))
	for _, m := range matches {
		specs = append(specs, m[1])
	}
	return specs
}

func importsPrisma(content string, specs []string) bool {
	for _, m := range namedImportRe.FindAllStringSubmatch(content, -1) {
		for _, name := range strings.Split(m[1], ",") {
			if strings.TrimSpace(name) == "PrismaRepository" {
				return true
			}
		}
	}
	for _, spec := range specs {
		if spec == "@langwatch/prisma-client" || strings.Contains(spec, "prisma-client") {
			return true
		}
	}
	return false
}

func hasDatastoreImport(specs []string) bool {
	tier, _ := datastoreTier(specs)
	return tier != ""
}

// datastoreTier reports whether any import specifier names a ClickHouse or
// Redis client package, and which one.
func datastoreTier(specs []string) (Tier, string) {
	for _, spec := range specs {
		lower := strings.ToLower(spec)
		if strings.Contains(lower, "clickhouse") {
			return TierClickhouse, spec
		}
		if strings.Contains(lower, "redis") {
			return TierRedis, spec
		}
	}
	return "", ""
}

// exportedSymbol returns the exported class or interface name the file's
// concrete implementation carries, and which kind it is ("class", "abstract
// class" or "interface"). A file often exports a helper interface (dependency
// bags, tiny client shapes) ahead of its actual class or abstract class, so
// a class/abstract class match always wins over an interface match.
func exportedSymbol(content string) (name, kind string) {
	matches := classOrIfaceRe.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return "", ""
	}
	for _, m := range matches {
		if m[1] != "interface" {
			return m[2], m[1]
		}
	}
	return matches[0][2], matches[0][1]
}

// repositoryShapedMembers reports whether the file declares a method whose
// name starts with one of the repository verbs, and which verb matched.
func repositoryShapedMembers(content string) (string, bool) {
	for _, m := range methodNameRe.FindAllStringSubmatch(content, -1) {
		name := m[1]
		lower := strings.ToLower(name)
		for _, verb := range repositoryVerbs {
			if strings.HasPrefix(lower, verb) {
				return name, true
			}
		}
	}
	return "", false
}
