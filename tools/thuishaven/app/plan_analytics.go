package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// analyticsEnv is analyticssim's own configuration, wherever it runs.
func analyticsEnv(st domain.Stack) []string {
	var port int
	for _, svc := range st.Services {
		if svc.Name == domain.AnalyticsService {
			port = svc.Port
		}
	}
	return []string{fmt.Sprintf("ANALYTICSSIM_ADDR=:%d", port), "ANALYTICSSIM_STACK=" + st.Slug}
}

// analyticsChild is the supervised analyticssim lane. It keeps nothing on disk: its
// console shows the records since it started.
func (o *Orchestrator) analyticsChild(st domain.Stack, repoRoot string, base []string) Child {
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.AnalyticsService, Dir: repoRoot, Color: palette[4], LogPath: filepath.Join(logDir, domain.AnalyticsService+".log"),
		Shell: o.simulatorShell("analytics"),
		Env:   append(append(append([]string{}, base...), domain.LaneEnv(domain.AnalyticsService)), analyticsEnv(st)...),
	}
}
