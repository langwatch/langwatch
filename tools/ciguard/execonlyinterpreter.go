package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

// An execute-only interpreter is what hides a code block's process on AWS
// Lambda, and it also makes the engine keep every run in its process group,
// which refuses setsid and setpgid to user code. That is right on Lambda and
// a needless restriction anywhere else, so only the lambda stage may ship the
// interpreter execute-only, and it must (specs/nlp-go/_shared/contract.md §7).

// ExecOnlyInterpreter reports an execute-only python COPY outside the lambda
// stage of GoServicesDockerfile, and a lambda stage without one.
func ExecOnlyInterpreter(repoRoot string) ([]string, error) {
	body, err := os.ReadFile(filepath.Join(repoRoot, GoServicesDockerfile))
	if err != nil {
		return nil, err
	}
	var problems []string
	inLambda := false
	for _, stage := range execOnlyInterpreterStages(string(body)) {
		if strings.EqualFold(stage, LambdaStage) {
			inLambda = true
			continue
		}
		problems = append(problems, fmt.Sprintf("%s: stage %q ships the interpreter execute-only; only the %s stage may", GoServicesDockerfile, stage, LambdaStage))
	}
	if !inLambda {
		problems = append(problems, fmt.Sprintf("%s: the %s stage does not ship the interpreter execute-only (COPY --chmod=0711 .../python3.11)", GoServicesDockerfile, LambdaStage))
	}

	return problems, nil
}

// execOnlyInterpreterStages names the stage of each instruction that leaves
// the python interpreter execute-only: a COPY with such a --chmod, or a RUN
// chmod of it. Continued lines are read as one instruction.
func execOnlyInterpreterStages(dockerfile string) []string {
	var stages []string
	stage := ""
	for _, line := range joinedInstructions(dockerfile) {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if strings.EqualFold(fields[0], "FROM") {
			stage = fromStage(fields[1:]).name
		} else if leavesInterpreterExecOnly(fields) {
			stages = append(stages, stage)
		}
	}

	return stages
}

// leavesInterpreterExecOnly judges one COPY or RUN instruction.
func leavesInterpreterExecOnly(fields []string) bool {
	switch strings.ToUpper(fields[0]) {
	case "COPY":
		return copiesExecOnlyInterpreter(fields[1:])
	case "RUN":
		return chmodsExecOnlyInterpreter(fields[1:])
	}

	return false
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

// copiesExecOnlyInterpreter reads `COPY [--flag...] src... dst`: a copy that
// names python (as a source or the destination) with a --chmod that leaves
// others without read.
func copiesExecOnlyInterpreter(args []string) bool {
	mode := ""
	names := false
	for _, arg := range args {
		if value, ok := strings.CutPrefix(arg, "--chmod="); ok {
			mode = value
		} else if !strings.HasPrefix(arg, "--") && namesPython(arg) {
			names = true
		}
	}

	return names && mode != "" && leavesOthersNoRead(mode)
}

// chmodsExecOnlyInterpreter reads a RUN for `chmod <mode> ...python...`.
func chmodsExecOnlyInterpreter(args []string) bool {
	for i, arg := range args {
		if filepath.Base(arg) != "chmod" || i+2 >= len(args) {
			continue
		}
		if leavesOthersNoRead(args[i+1]) && slices.ContainsFunc(args[i+2:], namesPython) {
			return true
		}
	}

	return false
}

func namesPython(path string) bool {
	return strings.Contains(filepath.Base(path), "python")
}

// leavesOthersNoRead is true for an octal mode without o+r, or a symbolic one
// that takes read from others (o-r, go-r, a-r).
func leavesOthersNoRead(mode string) bool {
	if bits, err := strconv.ParseUint(mode, 8, 32); err == nil {
		return bits&0o004 == 0
	}
	who, _, ok := strings.Cut(mode, "-")

	return ok && strings.ContainsAny(who, "oa") && strings.Contains(mode, "-r")
}
