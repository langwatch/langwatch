package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// llmChild is the supervised llmsim lane. It keeps nothing on disk: its
// console shows the calls since it started.
func (o *Orchestrator) llmChild(st domain.Stack, repoRoot string, base []string) Child {
	var port int
	for _, svc := range st.Services {
		if svc.Name == domain.LLMService {
			port = svc.Port
		}
	}
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.LLMService, Dir: repoRoot, Color: palette[3], LogPath: filepath.Join(logDir, domain.LLMService+".log"),
		Shell: o.simulatorShell("llm"),
		Env: append(append([]string{}, base...),
			domain.LaneEnv(domain.LLMService),
			fmt.Sprintf("LLMSIM_ADDR=:%d", port),
			"LLMSIM_STACK="+st.Slug,
		),
	}
}
