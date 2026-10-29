package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
)

// Lambda runs a container image as its own least-privileged user, never the
// image's USER. The distroless nonroot bases set WORKDIR /home/nonroot, mode
// 0700 for uid 65532, which that user cannot enter, so every start fails with
// Runtime.InvalidEntrypoint before the runtime runs anything. The image is
// valid everywhere else, so no build catches it: a release shipped one and
// broke every studio workflow on the projects it reached.

// LambdaDockerfileGlob names the Dockerfiles whose last stage is a Lambda
// image. Another Dockerfile builds one as its stage named LambdaStage.
const LambdaDockerfileGlob = "infra/docker/Dockerfile.*.lambda"

// LambdaStage is the stage a Dockerfile that builds other images too builds
// its Lambda image as, such as Dockerfile.go's.
const LambdaStage = "lambda"

// LambdaWorkdir reports each Lambda image whose stage sets no WORKDIR of its
// own or through the stage it builds on, or one under /home.
func LambdaWorkdir(repoRoot string) ([]string, error) {
	paths, err := filepath.Glob(filepath.Join(repoRoot, "infra", "docker", "Dockerfile*"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)

	var problems []string
	found := false
	for _, path := range paths {
		body, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		target, ok := lambdaTarget(path, string(body))
		if !ok {
			continue
		}
		found = true
		if problem := lambdaWorkdirProblem(stageWorkdir(string(body), target)); problem != "" {
			rel, _ := filepath.Rel(repoRoot, path)
			problems = append(problems, fmt.Sprintf("%s: %s", rel, problem))
		}
	}
	if !found {
		return []string{fmt.Sprintf("no Lambda Dockerfiles match %s, and none has a %s stage", LambdaDockerfileGlob, LambdaStage)}, nil
	}

	return problems, nil
}

// lambdaTarget is the stage of the Dockerfile a Lambda image is built from,
// "" for the last, and whether it builds one at all.
func lambdaTarget(path, dockerfile string) (string, bool) {
	if ok, _ := filepath.Match(filepath.Base(LambdaDockerfileGlob), filepath.Base(path)); ok {
		return "", true
	}
	for _, st := range dockerStages(dockerfile) {
		if strings.EqualFold(st.name, LambdaStage) {
			return LambdaStage, true
		}
	}

	return "", false
}

func lambdaWorkdirProblem(workdir string) string {
	switch {
	case workdir == "":
		return "the runtime stage sets no WORKDIR, so it inherits the base image's; set one Lambda's user can enter, such as /"
	case workdir == "/home" || strings.HasPrefix(workdir, "/home/"):
		return fmt.Sprintf("the runtime stage starts in %s, which Lambda's user cannot enter; start from / instead", workdir)
	default:
		return ""
	}
}

// dockerStage is one FROM: its alias, what it builds on, and its last WORKDIR.
type dockerStage struct {
	name, from, workdir string
}

func dockerStages(dockerfile string) []dockerStage {
	var stages []dockerStage
	for _, line := range strings.Split(dockerfile, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		switch strings.ToUpper(fields[0]) {
		case "FROM":
			stages = append(stages, fromStage(fields[1:]))
		case "WORKDIR":
			if len(fields) > 1 && len(stages) > 0 {
				stages[len(stages)-1].workdir = fields[1]
			}
		}
	}

	return stages
}

// fromStage reads `FROM [--flag...] base [AS name]`.
func fromStage(args []string) dockerStage {
	for len(args) > 0 && strings.HasPrefix(args[0], "--") {
		args = args[1:]
	}
	var st dockerStage
	if len(args) > 0 {
		st.from = args[0]
	}
	if len(args) > 2 && strings.EqualFold(args[1], "AS") {
		st.name = args[2]
	}

	return st
}

// stageWorkdir is the WORKDIR the target stage (the last, for "") starts its
// command in: its own last WORKDIR, else that of the earlier stage it builds
// on, else "" for the base image's.
func stageWorkdir(dockerfile, target string) string {
	stages := dockerStages(dockerfile)
	i := len(stages) - 1
	if target != "" {
		i = slices.IndexFunc(stages, func(st dockerStage) bool { return strings.EqualFold(st.name, target) })
	}
	for i >= 0 {
		st := stages[i]
		if st.workdir != "" {
			return st.workdir
		}
		i = slices.IndexFunc(stages[:i], func(p dockerStage) bool { return p.name != "" && strings.EqualFold(p.name, st.from) })
	}

	return ""
}
