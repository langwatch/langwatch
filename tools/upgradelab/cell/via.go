package cell

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// viaRelease is the operator's middle release (UM-21, below the floor): the old release stops, the
// via release's own startup migrates the stores and it serves for -at-cut, then head deploys as usual.
func (cell *run) viaRelease(ctx context.Context) error {
	cell.stopFrom()
	cell.noteStores(ctx, "after the old release stopped")
	dir := filepath.Join(cell.options.ViaDir, "platform", "app")
	var log []byte
	for _, script := range FromStartup {
		command := exec.CommandContext(ctx, "pnpm", append([]string{"-s", "run"}, script...)...) // #nosec G204 -- fixed argv.
		command.Dir, command.Env = dir, cell.fromEnvWith(nil)
		out, err := command.CombinedOutput()
		log = append(log, out...)
		if err != nil {
			_ = os.WriteFile(cell.logPath("via-schema"), log, 0o600)
			return fmt.Errorf("via release %s: %w: %s", strings.Join(script, " "), err, tail(out))
		}
	}
	_ = os.WriteFile(cell.logPath("via-schema"), log, 0o600)
	cell.mark("viaMigrated")
	port := mustPort()
	url := "http://127.0.0.1:" + itoa(port)
	for _, spec := range []ProcSpec{
		{Name: "via-app", Args: FromAppArgs, Env: cell.fromEnvWith(map[string]string{"PORT": itoa(port)})},
		{Name: "via-worker", Args: FromWorkerArgs, Env: cell.fromEnvWith(map[string]string{"PORT": itoa(port), "WORKER_METRICS_PORT": itoa(mustPort()), "VOICE_WS_PORT": itoa(mustPort())})},
	} {
		spec.Dir, spec.Log = dir, cell.logPath(spec.Name)
		proc, err := Start(spec)
		if err != nil {
			return err
		}
		cell.addProc(proc)
	}
	if err := waitFor(ctx, cell.options.ReadyWithin, func() bool {
		status, _, err := get(ctx, httpClient, url+"/api/health")
		return err == nil && status/100 == 2
	}); err != nil {
		return fmt.Errorf("via release did not answer /api/health: %w", err)
	}
	if err := cell.balancer.Switch(url); err != nil {
		return err
	}
	cell.mark("viaUp")
	cell.announce("via release is up")
	if err := sleep(ctx, cell.options.AtCut); err != nil {
		return err
	}
	cell.noteStores(ctx, "with the via release serving")
	return nil
}

// stopVia stops the via release, when one ran, as stopFrom stops the old release.
func (cell *run) stopVia() {
	for _, proc := range cell.procList() {
		if proc.Name == "via-app" || proc.Name == "via-worker" {
			proc.Stop(20 * time.Second)
		}
	}
}

// noteStores records _prisma_migrations rows and whether a ledger schema exists, the writes a refused upgrade must not make.
func (cell *run) noteStores(ctx context.Context, when string) {
	all, finished := cell.prismaRowCounts(ctx)
	ledger, _ := psql(ctx, cell.stores.psqlURL(), `SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE '%upgrade_ledger%'`)
	cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("stores %s: _prisma_migrations %d rows (%d finished), ledger schemas %s", when, all, finished, strings.TrimSpace(ledger)))
}
