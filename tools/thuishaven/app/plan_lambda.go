package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// lambdaChild is the supervised lambdasim lane. It keeps nothing on disk: its
// functions and calls are the ones since it started.
func (o *Orchestrator) lambdaChild(st domain.Stack, repoRoot string, base []string) Child {
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.LambdaService, Dir: repoRoot, Color: palette[2], LogPath: filepath.Join(logDir, domain.LambdaService+".log"),
		Shell: o.simulatorShell("lambda"),
		Env:   append(append(append([]string{}, base...), domain.LaneEnv(domain.LambdaService)), lambdaEnv(st)...),
	}
}

// lambdaEnv is lambdasim's own configuration: every invocation runs on this stack's nlpgo.
func lambdaEnv(st domain.Stack) []string {
	var port, nlp int
	for _, svc := range st.Services {
		switch svc.Name {
		case domain.LambdaService:
			port = svc.Port
		case "nlp":
			nlp = svc.Port
		}
	}
	return []string{
		fmt.Sprintf("LAMBDASIM_ADDR=:%d", port), "LAMBDASIM_STACK=" + st.Slug,
		fmt.Sprintf("LAMBDASIM_TARGET=http://127.0.0.1:%d", nlp),
	}
}
