package readmegen

import (
	"fmt"
	"io"
	"strings"
)

// packageGroups is W-22's closed list of `"langwatch": { "group" }` values, in
// the order packages/README.md shows them; --check refuses a package without one.
var packageGroups = []string{"framework", "browser", "data", "telemetry", "tooling", "libraries"}

// groupedPrefix is where every package must declare a group.
const groupedPrefix = "packages/"

// groupOrder is a group's position in the closed list; an unlisted group sorts last.
func groupOrder(groups []string, group string) int {
	for index, name := range groups {
		if name == group {
			return index
		}
	}
	return len(groups)
}

// groupProblems names every grouped package whose group is missing or outside the list.
func groupProblems(packages []workspacePackage, groups []string) []string {
	var problems []string
	for _, pkg := range packages {
		rest := strings.TrimPrefix(pkg.Dir, groupedPrefix)
		if !strings.HasPrefix(pkg.Dir, groupedPrefix) || strings.Contains(rest, "/") {
			continue
		}
		group := pkg.LangWatch.Group
		switch {
		case group == "" && len(groups) > 0:
			problems = append(problems, fmt.Sprintf("%s/package.json: declare \"langwatch\": { \"group\": … }, one of %s", pkg.Dir, strings.Join(groups, ", ")))
		case group != "" && groupOrder(groups, group) == len(groups):
			problems = append(problems, fmt.Sprintf("%s/package.json: group %q is not in the closed list (tools/readmegen/groups.go)", pkg.Dir, group))
		}
	}
	return problems
}

func reportGroups(ws *workspace, groups []string, stderr io.Writer) int {
	problems := groupProblems(ws.packages, groups)
	for _, problem := range problems {
		fmt.Fprintln(stderr, problem)
	}
	return len(problems)
}
