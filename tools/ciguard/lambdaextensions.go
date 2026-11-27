package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// GoServicesDockerfile builds the NLP service, the gateway and the NLP Lambda
// image as stages of one file.
const GoServicesDockerfile = "infra/docker/Dockerfile.go-services"

// Lambda reads every file in /opt/extensions to start it: an execute-only one
// is never started, and init times out with no EXTENSION line in the log. The
// web adapter itself must stay execute-only, since its process holds what the
// function runs with, so the image starts it through a readable launcher
// (cmd/lambdaextension) and keeps it at LambdaAdapterPath.

// LambdaAdapterPath is where the lambda stage keeps the real web adapter.
const LambdaAdapterPath = "/opt/lwa/lambda-adapter"

// LambdaExtensions reports an /opt/extensions file the lambda stage of
// GoServicesDockerfile does not make readable, and a web adapter at
// LambdaAdapterPath that is missing or readable.
func LambdaExtensions(repoRoot string) ([]string, error) {
	body, err := os.ReadFile(filepath.Join(repoRoot, GoServicesDockerfile))
	if err != nil {
		return nil, err
	}
	var problems []string
	adapter := false
	for _, c := range stageCopies(string(body), LambdaStage) {
		switch {
		case strings.HasPrefix(c.dest, "/opt/extensions/") && !c.readable():
			problems = append(problems, fmt.Sprintf("%s: %s is mode %s; Lambda must read an extension to start it", GoServicesDockerfile, c.dest, c.mode))
		case c.dest == LambdaAdapterPath:
			adapter = true
			if c.mode == "" || c.readable() {
				problems = append(problems, fmt.Sprintf("%s: %s must be execute-only (--chmod=0711)", GoServicesDockerfile, c.dest))
			}
		}
	}
	if !adapter {
		problems = append(problems, fmt.Sprintf("%s: the %s stage does not ship the web adapter at %s", GoServicesDockerfile, LambdaStage, LambdaAdapterPath))
	}

	return problems, nil
}

// dockerCopy is one COPY: its destination and its --chmod, "" when unset.
type dockerCopy struct{ dest, mode string }

// readable reports whether others may read the file: true without --chmod,
// since a COPY keeps the source's mode and Lambda's own files are readable.
func (c dockerCopy) readable() bool {
	if c.mode == "" {
		return true
	}
	bits, err := strconv.ParseUint(c.mode, 8, 32)
	return err == nil && bits&0o004 != 0
}

// stageCopies is every COPY of the named stage.
func stageCopies(dockerfile, stage string) []dockerCopy {
	var copies []dockerCopy
	current := ""
	for _, line := range strings.Split(dockerfile, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		switch strings.ToUpper(fields[0]) {
		case "FROM":
			current = fromStage(fields[1:]).name
		case "COPY":
			if strings.EqualFold(current, stage) {
				copies = append(copies, copyOf(fields[1:]))
			}
		}
	}
	return copies
}

func copyOf(args []string) dockerCopy {
	var c dockerCopy
	for _, arg := range args {
		if mode, ok := strings.CutPrefix(arg, "--chmod="); ok {
			c.mode = mode
		} else if !strings.HasPrefix(arg, "--") {
			c.dest = arg
		}
	}
	return c
}
