package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// voiceChild is the supervised voicesim lane. It keeps nothing on disk: its
// console shows the calls since it started.
func (o *Orchestrator) voiceChild(st domain.Stack, repoRoot string, base []string) Child {
	var port int
	for _, svc := range st.Services {
		if svc.Name == domain.VoiceService {
			port = svc.Port
		}
	}
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.VoiceService, Dir: repoRoot, Color: palette[6], LogPath: filepath.Join(logDir, domain.VoiceService+".log"),
		Shell: o.simulatorShell("voice"),
		Env: append(append([]string{}, base...),
			domain.LaneEnv(domain.VoiceService),
			fmt.Sprintf("VOICESIM_ADDR=:%d", port),
			"VOICESIM_STACK="+st.Slug,
		),
	}
}
