package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// outboundEnv is outboundsim's own configuration, wherever it runs.
func outboundEnv(st domain.Stack) []string {
	var port int
	for _, svc := range st.Services {
		if svc.Name == domain.OutboundService {
			port = svc.Port
		}
	}
	return []string{fmt.Sprintf("OUTBOUNDSIM_ADDR=:%d", port), "OUTBOUNDSIM_STACK=" + st.Slug, "OUTBOUNDSIM_SEED=1"}
}

// outboundChild is the supervised outboundsim lane. It keeps nothing on disk: its
// console shows the records since it started.
func (o *Orchestrator) outboundChild(st domain.Stack, repoRoot string, base []string) Child {
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.OutboundService, Dir: repoRoot, Color: palette[7], LogPath: filepath.Join(logDir, domain.OutboundService+".log"),
		Shell: o.simulatorShell("outbound"),
		Env:   append(append(append([]string{}, base...), domain.LaneEnv(domain.OutboundService)), outboundEnv(st)...),
	}
}
