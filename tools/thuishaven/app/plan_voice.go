package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// voiceChild is the supervised voicesim lane. It keeps nothing on disk: its
// console shows the calls since it started.
func (o *Orchestrator) voiceChild(st domain.Stack, repoRoot string, base []string) Child {
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.VoiceService, Dir: repoRoot, Color: palette[6], LogPath: filepath.Join(logDir, domain.VoiceService+".log"),
		Shell: o.simulatorShell("voice"),
		Env:   append(append(append([]string{}, base...), domain.LaneEnv(domain.VoiceService)), voiceEnv(st)...),
	}
}

// voiceEnv is voicesim's own configuration, wherever it runs.
func voiceEnv(st domain.Stack) []string {
	var port int
	for _, svc := range st.Services {
		if svc.Name == domain.VoiceService {
			port = svc.Port
		}
	}
	return []string{fmt.Sprintf("VOICESIM_ADDR=:%d", port), "VOICESIM_STACK=" + st.Slug, "VOICESIM_SEED=1"}
}
