package shapemod

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Entry is one ports/adapters file with its classification and, when it
// moves, the destination path and symbol rename.
type Entry struct {
	// OldPath is repository-relative, e.g. modules/api-key/server/src/ports/x.port.ts.
	OldPath string
	Classification
	// Name is the repository subject derived from the filename, e.g.
	// "agent-sandbox-key-share".
	Name string
	// NewPath is repository-relative, empty when the tier is Infrastructure.
	NewPath string
	// NewSymbol is the renamed class/interface, empty when Symbol is empty
	// or the tier is Infrastructure.
	NewSymbol string
	// Tests are __tests__ files (repository-relative) that import this
	// file and move alongside it.
	Tests []string
}

// tierPrefix names the PascalCase prefix a moved symbol and file take.
func tierPrefix(t Tier) string {
	switch t {
	case TierPrisma:
		return "Prisma"
	case TierMemory:
		return "Memory"
	case TierClickhouse:
		return "Clickhouse"
	case TierRedis:
		return "Redis"
	default:
		return ""
	}
}

var kindSuffixes = map[string]bool{"port": true, "adapter": true, "store": true}

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

func pascalCase(kebab string) string {
	parts := strings.FieldsFunc(kebab, func(r rune) bool { return r == '-' || r == '_' })
	var b strings.Builder
	for _, p := range parts {
		if p == "" {
			continue
		}
		b.WriteString(strings.ToUpper(p[:1]))
		b.WriteString(p[1:])
	}
	return b.String()
}

// PlanEntry classifies one file and computes its destination, given the
// module's server/src directory (repository-relative).
func PlanEntry(oldPath, serverSrc, content string) Entry {
	c := Classify(content)
	name := subjectName(filepath.Base(oldPath))
	e := Entry{OldPath: oldPath, Classification: c, Name: name}

	if c.Tier == TierInfrastructure {
		return e
	}

	prefix := tierPrefix(c.Tier)
	repoName := prefix + pascalCase(name) + "Repository"
	if c.Tier == TierInterface {
		repoName = pascalCase(name) + "Repository"
	}

	switch c.Tier {
	case TierInterface:
		e.NewPath = filepath.Join(serverSrc, "repositories", name+".repository.ts")
	case TierPrisma:
		e.NewPath = filepath.Join(serverSrc, "repositories", "prisma", "prisma."+name+".repository.ts")
	case TierMemory:
		e.NewPath = filepath.Join(serverSrc, "repositories", "memory", "memory."+name+".repository.ts")
	case TierClickhouse:
		e.NewPath = filepath.Join(serverSrc, "repositories", "clickhouse", "clickhouse."+name+".repository.ts")
	case TierRedis:
		e.NewPath = filepath.Join(serverSrc, "repositories", "redis", "redis."+name+".repository.ts")
	}
	if c.Symbol != "" {
		e.NewSymbol = repoName
	}
	return e
}

var relativeImportRe = regexp.MustCompile(`(?m)from\s+["'](\.[^"']+)["']`)

// FindTests returns the __tests__ files (repository-relative, under dir)
// whose relative import resolves to subjectFile (repository-relative, no
// extension needed on either side).
func FindTests(dir, subjectFile string) ([]string, error) {
	testsDir := filepath.Join(dir, "__tests__")
	entries, err := os.ReadDir(testsDir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	subjectBase := strings.TrimSuffix(filepath.Base(subjectFile), filepath.Ext(subjectFile))
	var found []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := filepath.Join(testsDir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		for _, m := range relativeImportRe.FindAllStringSubmatch(string(data), -1) {
			imported := strings.TrimSuffix(filepath.Base(m[1]), filepath.Ext(m[1]))
			if imported == subjectBase {
				found = append(found, path)
				break
			}
		}
	}
	sort.Strings(found)
	return found, nil
}
