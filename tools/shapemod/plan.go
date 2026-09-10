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

// PlanEntry classifies one file and computes its destination, given the
// module's server/src directory (repository-relative).
func PlanEntry(oldPath, serverSrc, content string) Entry {
	c := Classify(oldPath, content)
	name := subjectName(filepath.Base(oldPath))
	e := Entry{OldPath: oldPath, Classification: c, Name: name}

	if c.Tier == TierInfrastructure || c.Tier == TierSplit {
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
