package shapemod

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
)

// RegistryLine reports one repository subject's prisma/memory coverage
// against the module's *-repositories.registry.ts.
type RegistryLine struct {
	Name          string
	PrismaClass   string // "" means missing
	MemoryClass   string // "" means missing
	RegistryFound bool
}

func (l RegistryLine) String() string {
	prisma := l.PrismaClass
	if prisma == "" {
		prisma = "MISSING-PRISMA-TWIN"
	}
	memory := l.MemoryClass
	if memory == "" {
		memory = "MISSING-MEMORY-TWIN"
	}
	registry := "registry present"
	if !l.RegistryFound {
		registry = "registry NOT FOUND (create repositories/<m>-repositories.registry.ts)"
	}
	return fmt.Sprintf("%-30s prisma=%-40s memory=%-40s %s", l.Name, prisma, memory, registry)
}

var classNameRe = regexp.MustCompile(`(?m)^\s*export\s+class\s+(\w+)`)

// RegistryReport computes, for every subject this run moved into the prisma
// or memory tier, whether both backends now exist on disk and whether the
// module's registry file exists. It never writes: appending a new key into
// prismaRepositories({...}) or a memory bundle's returned object literal is
// left to the operator, since that object shape is not guaranteed regular
// enough to edit with regexp alone (see README "unfinished").
func RegistryReport(root, moduleDir string, entries []Entry) []RegistryLine {
	names := map[string]bool{}
	for _, e := range entries {
		if e.Tier == TierPrisma || e.Tier == TierMemory || e.Tier == TierInterface {
			names[e.Name] = true
		}
	}
	if len(names) == 0 {
		return nil
	}

	serverSrc := filepath.Join(root, moduleDir, "server", "src")
	registryFound := len(globFiles(filepath.Join(serverSrc, "repositories"), "*-repositories.registry.ts")) > 0

	var lines []RegistryLine
	for _, name := range sortedKeys(names) {
		prismaPath := filepath.Join(serverSrc, "repositories", "prisma", "prisma."+name+".repository.ts")
		memoryPath := filepath.Join(serverSrc, "repositories", "memory", "memory."+name+".repository.ts")
		lines = append(lines, RegistryLine{
			Name:          name,
			PrismaClass:   classNameIn(prismaPath),
			MemoryClass:   classNameIn(memoryPath),
			RegistryFound: registryFound,
		})
	}
	return lines
}

func classNameIn(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	m := classNameRe.FindStringSubmatch(string(data))
	if m == nil {
		return ""
	}
	return m[1]
}

func globFiles(dir, pattern string) []string {
	matches, _ := filepath.Glob(filepath.Join(dir, pattern))
	return matches
}

func sortedKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func printRegistry(w io.Writer, lines []RegistryLine) {
	if len(lines) == 0 {
		return
	}
	fmt.Fprintln(w, "\nregistry coverage:")
	for _, l := range lines {
		fmt.Fprintln(w, "  "+l.String())
	}
}
