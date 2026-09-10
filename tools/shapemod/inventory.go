package shapemod

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// ModuleCounts is one module's ports/adapters files grouped by tier.
type ModuleCounts struct {
	ModuleDir string
	ByTier    map[Tier]int
	Total     int
}

// Inventory runs dev/scripts/shape-counters.sh for the headline counters,
// then classifies every module's ports/adapters files so a coordinator sees
// what `shapemod ports` can close per module.
func Inventory(root string, stdout, stderr io.Writer) []ModuleCounts {
	cmd := exec.Command("bash", "dev/scripts/shape-counters.sh")
	cmd.Dir = root
	out, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Fprintf(stderr, "shape-counters.sh: %v\n%s\n", err, out)
	} else {
		fmt.Fprint(stdout, string(out))
	}

	moduleDirs := discoverModuleDirs(root)
	var counts []ModuleCounts
	for _, m := range moduleDirs {
		c := ModuleCounts{ModuleDir: m, ByTier: map[Tier]int{}}
		sources := CollectSources(root, filepath.Join(m, "server", "src"))
		for _, sub := range []string{"ports", "adapters"} {
			dir := filepath.Join(root, m, "server", "src", sub)
			_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
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
				rel, relErr := filepath.Rel(root, path)
				if relErr != nil {
					return nil
				}
				cl := Classify(path, string(data), siblingsExcluding(sources, rel))
				c.ByTier[cl.Tier]++
				c.Total++
				return nil
			})
		}
		if c.Total > 0 {
			counts = append(counts, c)
		}
	}

	sort.Slice(counts, func(i, j int) bool { return counts[i].ModuleDir < counts[j].ModuleDir })
	printInventory(stdout, counts)
	return counts
}

// discoverModuleDirs finds every modules/<m> and enterprise/modules/<m> that
// has a server/src/{ports,adapters} directory, skipping dist/.
func discoverModuleDirs(root string) []string {
	var dirs []string
	for _, base := range []string{"modules", "enterprise/modules"} {
		entries, err := os.ReadDir(filepath.Join(root, base))
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			m := filepath.Join(base, e.Name())
			for _, sub := range []string{"ports", "adapters"} {
				if info, err := os.Stat(filepath.Join(root, m, "server", "src", sub)); err == nil && info.IsDir() {
					dirs = append(dirs, m)
					break
				}
			}
		}
	}
	sort.Strings(dirs)
	return dirs
}

func printInventory(w io.Writer, counts []ModuleCounts) {
	fmt.Fprintln(w, "\nports/adapters by module and classification:")
	fmt.Fprintf(w, "%-45s %6s %6s %6s %10s %5s %9s %6s\n",
		"MODULE", "PRISMA", "MEMORY", "REDIS", "CLICKHOUSE", "IFACE", "INFRA", "TOTAL")
	for _, c := range counts {
		fmt.Fprintf(w, "%-45s %6d %6d %6d %10d %5d %9d %6d\n",
			c.ModuleDir,
			c.ByTier[TierPrisma], c.ByTier[TierMemory], c.ByTier[TierRedis],
			c.ByTier[TierClickhouse], c.ByTier[TierInterface], c.ByTier[TierInfrastructure],
			c.Total)
	}
}
