package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Lambda runs a container image as its own least-privileged user, never the
// image's USER. The distroless nonroot bases set WORKDIR /home/nonroot, mode
// 0700 for uid 65532, which that user cannot enter, so every start fails with
// Runtime.InvalidEntrypoint before the runtime runs anything. The image is
// valid everywhere else, so no build catches it: a release shipped one and
// broke every studio workflow on the projects it reached.

// LambdaDockerfileGlob names the Lambda images' Dockerfiles.
const LambdaDockerfileGlob = "infra/docker/Dockerfile.*.lambda"

// LambdaWorkdir reports each Lambda Dockerfile whose runtime stage (the last
// FROM) sets no WORKDIR of its own, or one under /home.
func LambdaWorkdir(repoRoot string) ([]string, error) {
	paths, err := filepath.Glob(filepath.Join(repoRoot, LambdaDockerfileGlob))
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return []string{"no Lambda Dockerfiles match " + LambdaDockerfileGlob}, nil
	}
	sort.Strings(paths)

	var problems []string
	for _, path := range paths {
		body, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if problem := lambdaWorkdirProblem(string(body)); problem != "" {
			rel, _ := filepath.Rel(repoRoot, path)
			problems = append(problems, fmt.Sprintf("%s: %s", rel, problem))
		}
	}

	return problems, nil
}

func lambdaWorkdirProblem(dockerfile string) string {
	workdir := runtimeWorkdir(dockerfile)
	switch {
	case workdir == "":
		return "the runtime stage sets no WORKDIR, so it inherits the base image's; set one Lambda's user can enter, such as /"
	case workdir == "/home" || strings.HasPrefix(workdir, "/home/"):
		return fmt.Sprintf("the runtime stage starts in %s, which Lambda's user cannot enter; start from / instead", workdir)
	default:
		return ""
	}
}

// runtimeWorkdir is the last WORKDIR after the last FROM, or "".
func runtimeWorkdir(dockerfile string) string {
	workdir := ""
	for _, line := range strings.Split(dockerfile, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		switch strings.ToUpper(fields[0]) {
		case "FROM":
			workdir = ""
		case "WORKDIR":
			if len(fields) > 1 {
				workdir = fields[1]
			}
		}
	}

	return workdir
}
