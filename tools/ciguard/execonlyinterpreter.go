package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// An execute-only interpreter is what hides a code block's process on AWS
// Lambda, and it also makes the engine keep every run in its process group,
// which refuses setsid and setpgid to user code. That is right on Lambda and
// a needless restriction anywhere else, so only the lambda stage may ship the
// interpreter execute-only, and it must (specs/nlp-go/_shared/contract.md §7).

// ExecOnlyInterpreter reports a stage other than lambda that leaves the python
// interpreter execute-only, and a lambda stage that does not. The last
// instruction naming the interpreter decides; a stage starts from its parent.
func ExecOnlyInterpreter(repoRoot string) ([]string, error) {
	body, err := os.ReadFile(filepath.Join(repoRoot, GoServicesDockerfile))
	if err != nil {
		return nil, err
	}
	var problems []string
	stages, execOnly := interpreterFinalModes(string(body))
	for _, stage := range stages {
		if execOnly[stage] && !strings.EqualFold(stage, LambdaStage) {
			problems = append(problems, fmt.Sprintf("%s: stage %q ships the interpreter execute-only; only the %s stage may", GoServicesDockerfile, stage, LambdaStage))
		}
	}
	if !execOnly[LambdaStage] {
		problems = append(problems, fmt.Sprintf("%s: the %s stage does not ship the interpreter execute-only (COPY --chmod=0711 .../python3.11)", GoServicesDockerfile, LambdaStage))
	}

	return problems, nil
}

// interpreterFinalModes walks the stages in order and says, per stage,
// whether the interpreter ends it execute-only.
func interpreterFinalModes(dockerfile string) ([]string, map[string]bool) {
	var stages []string
	execOnly := map[string]bool{}
	stage := ""
	for _, line := range joinedInstructions(dockerfile) {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if strings.EqualFold(fields[0], "FROM") {
			from := fromStage(fields[1:])
			stage = from.name
			stages = append(stages, stage)
			execOnly[stage] = execOnly[from.from]
		} else if mode, names := interpreterMode(fields); names {
			execOnly[stage] = mode
		}
	}

	return stages, execOnly
}

// interpreterMode judges one COPY or RUN: whether it names the interpreter,
// and if so whether it leaves it execute-only.
func interpreterMode(fields []string) (execOnly, names bool) {
	switch strings.ToUpper(fields[0]) {
	case "COPY":
		return copiedInterpreterMode(fields[1:])
	case "RUN":
		return chmodedInterpreterMode(fields[1:])
	}

	return false, false
}

// joinedInstructions splits a Dockerfile into instructions, joining a line
// that ends in a backslash with the next.
func joinedInstructions(dockerfile string) []string {
	var out []string
	current := ""
	for _, line := range strings.Split(dockerfile, "\n") {
		trimmed := strings.TrimSpace(line)
		if body, continued := strings.CutSuffix(trimmed, "\\"); continued {
			current += body + " "
			continue
		}
		out = append(out, current+trimmed)
		current = ""
	}

	return append(out, current)
}

// copiedInterpreterMode reads `COPY [--flag...] src... dst`: a copy that
// names the interpreter (as a source or the destination) is execute-only when
// its --chmod is; without one the copy keeps the source's readable mode.
func copiedInterpreterMode(args []string) (execOnly, names bool) {
	mode := ""
	for _, arg := range args {
		if value, ok := strings.CutPrefix(arg, "--chmod="); ok {
			mode = value
		} else if !strings.HasPrefix(arg, "--") && namesInterpreter(arg) {
			names = true
		}
	}

	return names && mode != "" && executeOnly(mode), names
}

// chmodedInterpreterMode reads a RUN for `chmod <mode> ...python3...`.
func chmodedInterpreterMode(args []string) (execOnly, names bool) {
	for i, arg := range args {
		if filepath.Base(arg) == "chmod" && i+2 < len(args) && slices.ContainsFunc(args[i+2:], namesInterpreter) {
			return executeOnly(args[i+1]), true
		}
	}

	return false, false
}

var interpreterName = regexp.MustCompile(`^python3(\.[0-9]+)?$`)

func namesInterpreter(path string) bool {
	return interpreterName.MatchString(filepath.Base(path))
}

// executeOnly is true for a mode others may execute but not read: octal with
// o+x and no o+r, or a symbolic one that takes read (and only read) from
// others (o-r, go-r, a-r).
func executeOnly(mode string) bool {
	if bits, err := strconv.ParseUint(mode, 8, 32); err == nil {
		return bits&0o005 == 0o001
	}
	who, what, ok := strings.Cut(mode, "-")

	return ok && strings.ContainsAny(who, "oa") && strings.Contains(what, "r") && !strings.Contains(what, "x")
}
