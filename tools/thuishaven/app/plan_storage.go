package app

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// storageChild is the supervised storagesim lane. Objects persist per slug
// under haven's home, beside mail's, and only the stack's own app origin may
// call it from a browser.
func (o *Orchestrator) storageChild(st domain.Stack, repoRoot string, base []string) Child {
	var port int
	var appURL string
	for _, svc := range st.Services {
		switch svc.Name {
		case domain.StorageService:
			port = svc.Port
		case "app":
			appURL = svc.URL
		}
	}
	dataDir := filepath.Join(o.cfg.Home, "storage", st.Slug)
	_ = os.MkdirAll(dataDir, 0o700)
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.StorageService, Dir: repoRoot, Color: palette[4], LogPath: filepath.Join(logDir, domain.StorageService+".log"),
		Shell: o.simulatorShell("storage"),
		Env: append(append([]string{}, base...),
			domain.LaneEnv(domain.StorageService),
			fmt.Sprintf("STORAGESIM_ADDR=:%d", port),
			"STORAGESIM_DATA_DIR="+dataDir,
			"STORAGESIM_BUCKETS=langwatch",
			"STORAGESIM_CORS_ORIGINS="+appURL,
		),
	}
}
