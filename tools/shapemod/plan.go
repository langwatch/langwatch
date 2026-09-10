package shapemod

import (
	"io/fs"
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
// module's server/src directory (repository-relative) and siblings (every
// other .ts source under that server/src, keyed by repository-relative
// path) so Classify can check for an in-module implementation.
func PlanEntry(oldPath, serverSrc, content string, siblings map[string]string) Entry {
	c := Classify(oldPath, content, siblings)
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

// CollectSources reads every .ts file under serverSrc (repository-relative,
// resolved against root), excluding __tests__ directories, keyed by
// repository-relative path. Used to build the sibling set Classify checks
// for an in-module implementation.
func CollectSources(root, serverSrc string) map[string]string {
	sources := map[string]string{}
	_ = filepath.WalkDir(filepath.Join(root, serverSrc), func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".ts") {
			return nil
		}
		if strings.Contains(path, string(filepath.Separator)+"__tests__"+string(filepath.Separator)) {
			return nil
		}
		data, rerr := os.ReadFile(path)
		if rerr != nil {
			return nil
		}
		if rel, relErr := filepath.Rel(root, path); relErr == nil {
			sources[rel] = string(data)
		}
		return nil
	})
	return sources
}

// siblingsExcluding returns a copy of all with exclude removed, so a file
// is never checked against its own content as its "in-module implementation".
func siblingsExcluding(all map[string]string, exclude string) map[string]string {
	out := make(map[string]string, len(all))
	for k, v := range all {
		if k != exclude {
			out[k] = v
		}
	}
	return out
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
