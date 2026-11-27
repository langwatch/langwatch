package domain

import (
	"path/filepath"
	"regexp"
	"strings"
)

// RushGateHeldEnv is set by rush's gate on a run it admitted.
const RushGateHeldEnv = "RUSH_GATE_HELD"

// RushPassedEnv marks a command haven handed to rush's gate instead of queueing
// it. Seen again without RushGateHeldEnv, rush did not hold the run, so haven
// queues it: a launcher that hands its run back to haven can never loop.
const RushPassedEnv = "HAVEN_RUSH_PASSED"

// rushGatePreload is the tail of the Node preload rush's gate puts on NODE_OPTIONS.
const rushGatePreload = "/gate/node/preload.cjs"

// rushPreloadExempt mirrors the flags rush's preload lets through ungated.
var rushPreloadExempt = regexp.MustCompile(`^(--watch|-w|--lsp|--stdio|--help|-h|--version)$`)

// rushPackage mirrors the preload's read of a script's package and scope.
var rushPackage = regexp.MustCompile(`/node_modules/((@[^/]+)/)?([^/]+)/`)

// UnderRushGate is whether rush's gate already holds argv's run, or will hold it
// when it starts, so a haven slot on top would only hold haven's slot while rush
// queues the run. The preload on NODE_OPTIONS gates only the programs on its
// names list, so a preload without a list, or one that does not name argv's
// program, gates nothing. A nil argv (a whole shell) asks whether the list
// names any program. readFile reads the preload's names file.
func UnderRushGate(getenv func(string) string, readFile func(string) ([]byte, error), argv []string) bool {
	if getenv(RushGateHeldEnv) != "" {
		return true
	}
	if getenv(RushPassedEnv) != "" {
		return false
	}
	names := rushPreloadNames(getenv("NODE_OPTIONS"), readFile)
	if len(names) == 0 {
		return false
	}
	if argv == nil {
		return true
	}
	for _, candidate := range rushScriptCandidates(argv) {
		if names[candidate] {
			return true
		}
	}
	return false
}

// rushPreloadNames reads the programs rush's preload gates, from the names file
// beside it: the first line is rush's executable, the rest program names.
func rushPreloadNames(nodeOptions string, readFile func(string) ([]byte, error)) map[string]bool {
	for _, field := range strings.Fields(nodeOptions) {
		preload := strings.Trim(field, `"'`)
		if !strings.HasSuffix(preload, rushGatePreload) {
			continue
		}
		raw, err := readFile(filepath.Join(filepath.Dir(preload), "names"))
		if err != nil {
			return nil
		}
		lines := strings.Fields(string(raw))
		if len(lines) < 2 {
			return nil
		}
		names := map[string]bool{}
		for _, name := range lines[1:] {
			names[name] = true
		}
		return names
	}
	return nil
}

// rushScriptCandidates is what the preload would match argv's run by: the
// script's base name without its extension, its package and its scope. A run
// the preload lets through (--watch, --help and the like) has none.
func rushScriptCandidates(argv []string) []string {
	script, rest := rushScript(argv)
	if script == "" {
		return nil
	}
	for _, arg := range rest {
		if rushPreloadExempt.MatchString(arg) {
			return nil
		}
	}
	if real, err := filepath.EvalSymlinks(script); err == nil {
		script = real
	}
	base := filepath.Base(script)
	candidates := []string{strings.TrimSuffix(base, filepath.Ext(base))}
	if m := rushPackage.FindStringSubmatch(script); m != nil {
		candidates = append(candidates, m[3])
		if m[2] != "" {
			candidates = append(candidates, strings.TrimPrefix(m[2], "@"))
		}
	}
	return candidates
}

// rushScript finds the script a command runs: the first argument after node's
// own flags for a node command, else the command itself.
func rushScript(argv []string) (string, []string) {
	if len(argv) == 0 {
		return "", nil
	}
	if filepath.Base(argv[0]) != "node" {
		return argv[0], argv[1:]
	}
	for i := 1; i < len(argv); i++ {
		arg := argv[i]
		switch {
		case arg == "-r" || arg == "--require" || arg == "--import" || arg == "--loader":
			i++
		case strings.HasPrefix(arg, "-"):
		default:
			return arg, argv[i+1:]
		}
	}
	return "", nil
}
