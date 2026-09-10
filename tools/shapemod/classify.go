// Package shapemod moves modules/<m>/server/src/{ports,adapters} files onto
// the strict repository shape (repositories/{prisma,memory,clickhouse,redis}
// behind an interface, registered in a *-repositories.registry.ts), and finds
// dead legacy-transport files. Classification reads the filename, import
// lines and member names with regexp only — no TypeScript parser. tslsp-cli
// does the semantic move and rename.
package shapemod

import (
	"path/filepath"
	"regexp"
	"strings"
)

// Tier names a repository backend, Interface for a plain repository-shaped
// contract, Split for a file a person must divide before it can move, or
// Infrastructure for a file the codemod only reports on.
type Tier string

const (
	TierPrisma         Tier = "prisma"
	TierMemory         Tier = "memory"
	TierClickhouse     Tier = "clickhouse"
	TierRedis          Tier = "redis"
	TierInterface      Tier = "interface"
	TierInfrastructure Tier = "infrastructure"
	TierSplit          Tier = "split"
)

// Classification is the verdict for one ports/adapters file.
type Classification struct {
	Tier   Tier
	Reason string
	// Symbol is the exported class/interface name the file declares, empty
	// when none was found or the tier is Split.
	Symbol string
	// Exports lists every exported class/interface/abstract-class name
	// (error classes excluded) when Tier is Split, so a person can see what
	// to divide without opening the file.
	Exports []string
}

var (
	importFromRe = regexp.MustCompile(`(?m)from\s+["']([^"']+)["']`)
	declRe       = regexp.MustCompile(`(?m)^\s*export\s+(?:default\s+)?(abstract class|class|interface)\s+(\w+)(?:\s+extends\s+(\w+))?`)
	methodNameRe = regexp.MustCompile(`(?m)^\s*(?:abstract\s+)?(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+)*(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(`)
	methodBodyRe = regexp.MustCompile(`(?m)^(\s*)(abstract\s+)?(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+)*(?:async\s+)?\w+\s*(?:<[^>]*>)?\([^)]*\)\s*(?::\s*[^{;]+)?\s*([{;])`)
	prismaCallRe = regexp.MustCompile(`PrismaRepository\.for\(`)
	kindSuffixes = map[string]bool{"port": true, "adapter": true, "store": true}
	repoNameEnds = []string{"Port", "Store", "Repository"}
)

// repositoryVerbs are the method-name prefixes that mark an interface or
// abstract class as a repository rather than a technical port.
var repositoryVerbs = []string{"find", "create", "update", "delete", "list", "save", "upsert"}

type decl struct {
	Kind    string // "class", "abstract class", "interface"
	Name    string
	Extends string
}

// Classify inspects one ports/adapters file's filename and source and
// returns its target tier.
//
// Symbol selection comes first: the exported class or interface whose
// PascalCase name contains the filename's subject is the file's symbol.
// Error classes and type aliases are never candidates. A file with more than
// one candidate is Split and never moved or renamed.
//
// Tier order after that: Prisma (filename prefix postgres./prisma., a
// "prisma" import specifier, or a PrismaRepository.for( call), then Memory
// (filename prefix memory./in-memory. or symbol prefix Memory/InMemory —
// holding a Map proves nothing), then Redis/ClickHouse (filename prefix,
// symbol prefix, or a matching import specifier), then Interface (a single
// exported interface or abstract class named *Port/*Store/*Repository with a
// repository-verb member; an abstract class with a method body is Split
// instead), then Infrastructure for everything else.
func Classify(filename, content string) Classification {
	base := filepath.Base(filename)
	subject := subjectName(base)
	subjectPascal := pascalCase(subject)

	decls := declarations(content)
	candidates := subjectCandidates(decls, subjectPascal)

	if len(candidates) > 1 {
		names := make([]string, len(candidates))
		for i, d := range candidates {
			names[i] = d.Name
		}
		return Classification{
			Tier:    TierSplit,
			Reason:  "more than one export could be the subject " + subjectPascal + ": " + strings.Join(names, ", "),
			Exports: exportNames(decls),
		}
	}

	var symbol, kind string
	if len(candidates) == 1 {
		symbol, kind = candidates[0].Name, candidates[0].Kind
	}

	imports := importSpecifiers(content)

	if hasBasePrefix(base, "postgres.", "prisma.") {
		return Classification{Tier: TierPrisma, Reason: "filename prefix names a Prisma adapter", Symbol: symbol}
	}
	if spec, ok := importContaining(imports, "prisma"); ok {
		if importsSameSubjectPrismaRepository(spec, subject) {
			return Classification{
				Tier:   TierInfrastructure,
				Reason: "wraps the existing Prisma" + subjectPascal + "Repository of the same subject (" + spec + "); wiring, not a repository implementation",
				Symbol: symbol,
			}
		}
		return Classification{Tier: TierPrisma, Reason: "imports a prisma module (" + spec + ")", Symbol: symbol}
	}
	if prismaCallRe.MatchString(content) {
		return Classification{Tier: TierPrisma, Reason: "calls PrismaRepository.for(", Symbol: symbol}
	}

	if hasBasePrefix(base, "memory.", "in-memory.") {
		return Classification{Tier: TierMemory, Reason: "filename prefix names an in-memory adapter", Symbol: symbol}
	}
	if strings.HasPrefix(symbol, "Memory") || strings.HasPrefix(symbol, "InMemory") {
		return Classification{Tier: TierMemory, Reason: "exported symbol is Memory/InMemory-prefixed", Symbol: symbol}
	}

	if hasBasePrefix(base, "redis.") || strings.HasPrefix(symbol, "Redis") {
		return Classification{Tier: TierRedis, Reason: "filename or symbol names Redis", Symbol: symbol}
	}
	if spec, ok := importContaining(imports, "redis"); ok {
		return Classification{Tier: TierRedis, Reason: "imports a redis module (" + spec + ")", Symbol: symbol}
	}

	if hasBasePrefix(base, "clickhouse.") || strings.HasPrefix(symbol, "ClickHouse") || strings.HasPrefix(symbol, "Clickhouse") {
		return Classification{Tier: TierClickhouse, Reason: "filename or symbol names ClickHouse", Symbol: symbol}
	}
	if spec, ok := importContaining(imports, "clickhouse"); ok {
		return Classification{Tier: TierClickhouse, Reason: "imports a clickhouse module (" + spec + ")", Symbol: symbol}
	}

	if (kind == "interface" || kind == "abstract class") && hasRepoSuffix(symbol) {
		body := declBody(content, symbol)
		if verb, ok := repositoryShapedMembers(body); ok {
			if kind == "abstract class" && hasConcreteMethod(body) {
				return Classification{
					Tier:    TierSplit,
					Reason:  "abstract class " + symbol + " has a method body; split the concrete part out before it can become an interface",
					Exports: exportNames(decls),
				}
			}
			return Classification{Tier: TierInterface, Reason: "member " + verb + "(...) is repository-shaped", Symbol: symbol}
		}
	}

	return Classification{Tier: TierInfrastructure, Reason: "no datastore signal, no repository-shaped member", Symbol: symbol}
}

func hasBasePrefix(base string, prefixes ...string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(base, p) {
			return true
		}
	}
	return false
}

func hasRepoSuffix(name string) bool {
	for _, suffix := range repoNameEnds {
		if strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return false
}

func importSpecifiers(content string) []string {
	matches := importFromRe.FindAllStringSubmatch(content, -1)
	specs := make([]string, 0, len(matches))
	for _, m := range matches {
		specs = append(specs, m[1])
	}
	return specs
}

// importContaining reports whether any import specifier contains needle
// (case-insensitive), and returns that specifier.
func importContaining(specs []string, needle string) (string, bool) {
	for _, spec := range specs {
		if strings.Contains(strings.ToLower(spec), needle) {
			return spec, true
		}
	}
	return "", false
}

// importsSameSubjectPrismaRepository reports whether spec is an import of
// this file's own subject's Prisma repository (e.g. a file classifying as
// subject "thing" importing ".../prisma.thing.repository"), which marks the
// file as a thin wrapper around a repository that already exists rather than
// a repository implementation of its own.
func importsSameSubjectPrismaRepository(spec, subject string) bool {
	base := strings.TrimSuffix(filepath.Base(spec), filepath.Ext(spec))
	return strings.EqualFold(base, "prisma."+subject+".repository")
}

// declarations returns every exported class/abstract-class/interface in
// content, excluding error classes (name ends with Error, or extends Error)
// and, implicitly, type aliases (the regexp never matches them).
func declarations(content string) []decl {
	var out []decl
	for _, m := range declRe.FindAllStringSubmatch(content, -1) {
		d := decl{Kind: m[1], Name: m[2], Extends: m[3]}
		if d.Kind == "class" && (strings.HasSuffix(d.Name, "Error") || d.Extends == "Error") {
			continue
		}
		out = append(out, d)
	}
	return out
}

func exportNames(decls []decl) []string {
	names := make([]string, len(decls))
	for i, d := range decls {
		names[i] = d.Name
	}
	return names
}

// subjectCandidates returns the declarations whose PascalCase name contains
// subjectPascal. A class or abstract class candidate always wins over an
// interface candidate (an interface is often a small options bag alongside
// the file's real class), so interfaces are only considered when no
// class/abstract-class candidate exists.
func subjectCandidates(decls []decl, subjectPascal string) []decl {
	var classLike, ifaceLike []decl
	for _, d := range decls {
		if subjectPascal == "" || !strings.Contains(d.Name, subjectPascal) {
			continue
		}
		if d.Kind == "interface" {
			ifaceLike = append(ifaceLike, d)
		} else {
			classLike = append(classLike, d)
		}
	}
	if len(classLike) > 0 {
		return classLike
	}
	return ifaceLike
}

// declBody returns the source between name's declaration line's opening
// brace and its matching closing brace, so members are read from that one
// declaration and not from an unrelated class/interface sharing the file.
// Returns content unchanged if name's brace can't be found.
func declBody(content, name string) string {
	declStart := regexp.MustCompile(`(?m)^\s*export\s+(?:default\s+)?(?:abstract\s+class|class|interface)\s+` + regexp.QuoteMeta(name) + `\b`)
	loc := declStart.FindStringIndex(content)
	if loc == nil {
		return content
	}
	open := strings.IndexByte(content[loc[1]:], '{')
	if open == -1 {
		return content
	}
	start := loc[1] + open
	depth := 0
	for i := start; i < len(content); i++ {
		switch content[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return content[start : i+1]
			}
		}
	}
	return content[start:]
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

// hasConcreteMethod reports whether content declares a method with a body
// (ends its signature in `{`) that isn't marked abstract.
func hasConcreteMethod(content string) bool {
	for _, m := range methodBodyRe.FindAllStringSubmatch(content, -1) {
		isAbstract := m[2] != ""
		endsWithBrace := m[3] == "{"
		if !isAbstract && endsWithBrace {
			return true
		}
	}
	return false
}

// subjectName derives the repository subject from a ports/adapters filename:
// drop the .ts extension, drop the trailing port/adapter/store qualifier, and
// keep the last remaining dot-segment (a leading "redis."/"absent." prefix is
// a tier or variant hint, not part of the subject).
func subjectName(filename string) string {
	base := strings.TrimSuffix(filename, filepath.Ext(filename))
	parts := strings.Split(base, ".")
	if len(parts) > 1 && kindSuffixes[strings.ToLower(parts[len(parts)-1])] {
		parts = parts[:len(parts)-1]
	}
	return parts[len(parts)-1]
}

// properNouns is a small table of proper-noun words that keep their own
// capitalisation instead of the default "uppercase the first letter" rule,
// so a subject like "clickhouse-usage" becomes "ClickHouseUsage" and not
// "ClickhouseUsage".
var properNouns = map[string]string{
	"clickhouse": "ClickHouse",
	"openai":     "OpenAI",
	"langwatch":  "LangWatch",
	"sso":        "SSO",
	"scim":       "SCIM",
	"otlp":       "OTLP",
	"http":       "HTTP",
	"s3":         "S3",
}

func pascalCase(kebab string) string {
	parts := strings.FieldsFunc(kebab, func(r rune) bool { return r == '-' || r == '_' })
	var b strings.Builder
	for _, p := range parts {
		if p == "" {
			continue
		}
		if proper, ok := properNouns[strings.ToLower(p)]; ok {
			b.WriteString(proper)
			continue
		}
		b.WriteString(strings.ToUpper(p[:1]))
		b.WriteString(p[1:])
	}
	return b.String()
}
