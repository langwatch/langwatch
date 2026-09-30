package diffsuite

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// defaultTools are the suite `diffsuite -stack <slug> -out <dir>` runs. Each reads its
// stacks from the environment (diffkit.SuiteEnv), so no command names a URL.
var defaultTools = []tool{
	{name: "api", binary: "apidiff", command: `.bin/apidiff/apidiff scenarios -scenario-concurrency 16 -final -run-dir "$DIFFSUITE_OUT/apidiff"`},
	{name: "visual", binary: "visualdiff", command: ".bin/visualdiff/visualdiff check -routes -all"},
	{name: "fuzzapi", binary: "fuzz", command: ".bin/fuzz/fuzz api -duration 20m"},
	{name: "fuzzui", binary: "fuzz", command: ".bin/fuzz/fuzz ui -duration 20m -workers 3 -actions 10"},
}

func defaultNames() []string {
	names := make([]string, 0, len(defaultTools))
	for index := range defaultTools {
		names = append(names, defaultTools[index].name)
	}
	return names
}

func splitNames(value string) []string {
	var names []string
	for name := range strings.SplitSeq(value, ",") {
		if name = strings.TrimSpace(name); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// suiteTools are the named defaults, then each spec: name=command adds a tool or
// replaces one, name+=flags appends flags to one already in the suite.
func suiteTools(names, specs []string) ([]*tool, error) {
	var tools []*tool
	find := func(name string) *tool {
		for _, tool := range tools {
			if tool.name == name {
				return tool
			}
		}
		return nil
	}
	for _, name := range names {
		index := -1
		for candidate := range defaultTools {
			if defaultTools[candidate].name == name {
				index = candidate
			}
		}
		if index < 0 {
			return nil, fmt.Errorf("-tools: no default tool %q (have %s)", name, strings.Join(defaultNames(), ", "))
		}
		copied := defaultTools[index]
		tools = append(tools, &copied)
	}
	for _, spec := range specs {
		name, command, ok := strings.Cut(spec, "=")
		name, extend := strings.CutSuffix(name, "+")
		if !ok || name == "" || command == "" {
			return nil, fmt.Errorf("%q is not name=command or name+=flags", spec)
		}
		existing := find(name)
		switch {
		case extend && existing == nil:
			return nil, fmt.Errorf("%s+=: no tool %q in the suite", name, name)
		case extend:
			existing.command += " " + command
		case existing != nil:
			existing.command, existing.binary = command, ""
		default:
			tools = append(tools, &tool{name: name, command: command})
		}
	}
	return tools, nil
}

// build compiles the binaries the default commands run, so a suite never runs a stale one.
func (suite *suite) build(ctx context.Context, tools []*tool) error {
	built := map[string]bool{}
	for _, tool := range tools {
		if tool.binary == "" || built[tool.binary] {
			continue
		}
		built[tool.binary] = true
		command := exec.CommandContext(ctx, "go", "build", "-o", ".bin/"+tool.binary+"/"+tool.binary, "./cmd/"+tool.binary) // #nosec G204 -- fixed tool names.
		command.Dir, command.Stdout, command.Stderr = suite.root, suite.stderr, suite.stderr
		if err := command.Run(); err != nil {
			return fmt.Errorf("build %s: %w", tool.binary, err)
		}
	}
	return nil
}

// headCommit is the checkout's short HEAD, which the published header names.
func headCommit(root string) string {
	command := exec.Command("git", "rev-parse", "--short", "HEAD")
	command.Dir = root
	out, _ := command.Output()
	return strings.TrimSpace(string(out))
}

// repoRoot is the checkout the suite runs in, where the default commands' paths start.
func repoRoot() string {
	if out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output(); err == nil {
		return strings.TrimSpace(string(out))
	}
	root, _ := os.Getwd()
	return root
}
