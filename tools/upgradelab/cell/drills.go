package cell

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strings"
	"syscall"
	"time"
)

// Drills a cell can run on top of its profile (-drills a,b): each adds one invariant.
const (
	DrillAPIEarly      = "api-early"      // D1: the balancer switches as soon as head's api listens
	DrillWorkerRestart = "worker-restart" // D2: head's worker is killed mid-upgrade and restarted
	DrillRetry         = "retry"          // D3: a failed background step is retried from Ops > Upgrades
)

// drillState is what the drills measured.
type drillState struct {
	killedAtMs, killedDone, killedTotal int
	restartErr                          string
	retried                             string // the step D3 failed and retried
	retryStatus                         int
	retryBody                           string
	statuses                            []string // the step's status after the retry, sampled
	failedShot                          string   // Ops > Upgrades state while the step was failed
}

func (cell *run) drill(name string) bool { return slices.Contains(cell.options.Drills, name) }

// restartWorkerMidUpgrade (D2) runs inside the ready polls: once head's worker has a ledger with work
// done and work left, it is killed with SIGKILL, as a node loss would, and started again at once.
func (cell *run) restartWorkerMidUpgrade(ctx context.Context) {
	if !cell.drill(DrillWorkerRestart) || cell.drills.killedAtMs != 0 || FirstAt(cell.poller.Timeline(), "ready") >= 0 {
		return
	}
	rows, err := Ledger(ctx, cell.stores)
	done := countDone(rows)
	if err != nil || done == 0 || len(Outstanding(rows)) == 0 {
		return
	}
	worker := cell.proc("head-worker")
	worker.Signal(syscall.SIGKILL)
	waitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = worker.Wait(waitCtx)
	cell.drills.killedAtMs, cell.drills.killedDone, cell.drills.killedTotal = int(time.Since(cell.origin).Milliseconds()), done, len(rows)
	cell.procs = slices.DeleteFunc(cell.procs, func(proc *Proc) bool { return proc == worker })
	_ = os.Rename(cell.logPath("head-worker"), cell.logPath("head-worker-killed"))
	if err := cell.startHeadWorker(); err != nil {
		cell.drills.restartErr = err.Error()
	}
}

// retryFailedStep (D3) fails one finished background step as five exhausted attempts leave it (the
// harness writes the ledger: waiting out the real backoff takes over 15 minutes), shoots Ops >
// Upgrades, presses Retry through its procedure as the operator, and watches the step run again.
func (cell *run) retryFailedStep(ctx context.Context) error {
	if !cell.drill(DrillRetry) {
		return nil
	}
	step, err := psql(ctx, cell.stores.psqlURL(), `SELECT id FROM mydb_upgrade_ledger._langwatch_upgrade_step WHERE mode = 'background' AND status = 'done' ORDER BY id LIMIT 1`)
	if err != nil || step == "" {
		return fmt.Errorf("no finished background step to fail: %v", err)
	}
	cell.drills.retried = step
	if _, err := psql(ctx, cell.stores.psqlURL(), `UPDATE mydb_upgrade_ledger._langwatch_upgrade_step SET status = 'failed', last_error = 'upgradelab drill: injected after five attempts' WHERE id = '`+strings.ReplaceAll(step, "'", "")+`'`); err != nil {
		return err
	}
	if cell.options.Shots {
		cell.shoot(ctx, "drill-failed")
		cell.drills.failedShot = cell.lastShotState("drill-failed")
	}
	cell.drills.retryStatus, cell.drills.retryBody = cell.operatorMutation(ctx, "ops.upgrade.retryStep", map[string]any{"id": step})
	_ = waitFor(ctx, 3*time.Minute, func() bool {
		status, _ := psql(ctx, cell.stores.psqlURL(), `SELECT status FROM mydb_upgrade_ledger._langwatch_upgrade_step WHERE id = '`+strings.ReplaceAll(step, "'", "")+`'`)
		if len(cell.drills.statuses) == 0 || cell.drills.statuses[len(cell.drills.statuses)-1] != status {
			cell.drills.statuses = append(cell.drills.statuses, status)
		}
		return status == "done"
	})
	return nil
}

func (cell *run) lastShotState(phase string) string {
	cell.queueMu.Lock()
	defer cell.queueMu.Unlock()
	for index := len(cell.report.Shots) - 1; index >= 0; index-- {
		if cell.report.Shots[index].Phase == phase {
			return cell.report.Shots[index].State + errSuffix(cell.report.Shots[index].Error)
		}
	}
	return ""
}

// operatorMutation posts one tRPC mutation in head's plain-JSON wire with the seed account's session.
func (cell *run) operatorMutation(ctx context.Context, path string, input any) (int, string) {
	data, _ := json.Marshal(input)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, cell.url()+"/api/trpc/"+path, bytes.NewReader(data))
	if err != nil {
		return 0, err.Error()
	}
	request.Header = cell.client.Session.Clone()
	request.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return 0, err.Error()
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 400))
	return response.StatusCode, string(body)
}

// drillVerdicts judges each drill the cell ran.
func (cell *run) drillVerdicts(final []LedgerRow) []Verdict {
	var verdicts []Verdict
	if cell.drill(DrillAPIEarly) {
		verdicts = append(verdicts, apiEarlyDrillVerdict(cell.allCalls()))
	}
	if cell.drill(DrillWorkerRestart) {
		ready := FirstAt(cell.report.Phases, "ready")
		state := cell.drills
		verdicts = append(verdicts, verdict("D2", state.killedAtMs > 0 && state.restartErr == "" && ready > int64(state.killedAtMs),
			fmt.Sprintf("worker killed at %d ms with %d of %d steps done, restarted%s; ready at %d ms", state.killedAtMs, state.killedDone, state.killedTotal, errSuffix(state.restartErr), ready)))
	}
	if cell.drill(DrillRetry) {
		state, finalStatus := cell.drills, ""
		for _, row := range final {
			if row.ID == state.retried {
				finalStatus = row.Status
			}
		}
		verdicts = append(verdicts, verdict("D3", state.retryStatus == http.StatusOK && finalStatus == "done" && slices.Contains(state.statuses, "done"),
			fmt.Sprintf("step %s failed; Ops showed %q; retryStep answered %d %.160s; status after %v; final %q", state.retried, state.failedShot, state.retryStatus, state.retryBody, state.statuses, finalStatus)))
	}
	return verdicts
}

// apiEarlyDrillVerdict (D1): reads met upgrade_in_progress with Retry-After and each succeeded on retry.
func apiEarlyDrillVerdict(calls []Call) Verdict {
	met, recovered, missingHeader := 0, 0, 0
	for _, call := range calls {
		if call.UpgradeInProgress == 0 {
			continue
		}
		met++
		missingHeader += call.MissingRetryAfter
		if call.ok() {
			recovered++
		}
	}
	detail := fmt.Sprintf("%d calls met upgrade_in_progress, %d succeeded on retry, %d answers lacked Retry-After", met, recovered, missingHeader)
	if met == 0 {
		return Verdict{ID: "D1", Name: invariantNames["D1"], Result: "inconclusive", Detail: detail + ": no read reached a schema-behind table"}
	}
	return verdict("D1", recovered == met && missingHeader == 0, detail)
}
