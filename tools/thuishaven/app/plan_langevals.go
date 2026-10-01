package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// langevalsShell runs the evaluator service from the checkout's own source, the
// way the Go lanes run theirs: uv resolves the same frozen lock and extras the
// image (infra/docker/Dockerfile.langevals) installs, then starts the server,
// which binds PORT. A missing uv is said once, rather than read as a crash.
const langevalsShell = `command -v uv >/dev/null 2>&1 || { echo "langevals needs uv on PATH (brew install uv)" >&2; exit 1; }; ` +
	`exec uv run --frozen --no-dev --all-extras python langevals/server.py`

// langevalsChild is the supervised evaluator lane. Preload is off, as in
// dev/compose.dev.yml: evaluators load on first use, so the lane answers in
// seconds rather than after importing every model.
// ponytail: no memory cap on the host process (compose caps the container at
// 4 GiB); run it in colima like langy if a runaway evaluator bites.
func langevalsChild(repoDir string, port int, base []string, logPath string) Child {
	return Child{
		Name: domain.LangevalsService, Dir: filepath.Join(repoDir, "services", "langevals"),
		Color: palette[3], LogPath: logPath, Shell: langevalsShell,
		Env: append(append([]string{}, base...),
			domain.LaneEnv(domain.LangevalsService),
			fmt.Sprintf("PORT=%d", port),
			"DISABLE_EVALUATORS_PRELOAD=true",
		),
	}
}
