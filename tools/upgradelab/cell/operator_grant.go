package cell

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/generate"
)

// grantRetry bounds how long the cell keeps asking for the operator grant: a loaded head confirms it late.
type grantRetry struct {
	budget, first, ceiling time.Duration
}

var operatorGrantRetry = grantRetry{budget: 5 * time.Minute, first: 5 * time.Second, ceiling: time.Minute}

// retryableGrant is output a later attempt can outgrow: the grant still folding, or a store too busy to answer.
var retryableGrant = [][]byte{
	[]byte("authz_grant_not_confirmed"), []byte("AuthzGrantNotConfirmedError"), []byte("ECONNREFUSED"), []byte("ETIMEDOUT"),
	[]byte("Too many queries"),
}

// wait answers how long to sleep before attempt+1 (attempts count from 1), or false to give up.
func (retry grantRetry) wait(attempt int, elapsed time.Duration, out []byte) (time.Duration, bool) {
	if !grantRetryable(out) {
		return 0, false
	}
	delay := retry.first
	for range attempt - 1 {
		if delay = min(2*delay, retry.ceiling); delay == retry.ceiling {
			break
		}
	}
	if left := retry.budget - elapsed; left <= 0 {
		return 0, false
	} else if delay > left {
		delay = left
	}
	return delay, true
}

func grantRetryable(out []byte) bool {
	for _, marker := range retryableGrant {
		if bytes.Contains(out, marker) {
			return true
		}
	}
	return false
}

// grantOperator makes the seed account a platform operator on head (ADMIN_EMAILS grants nothing there),
// retrying a slow confirmation within operatorGrantRetry, and notes how long it took.
func (cell *run) grantOperator(ctx context.Context) {
	defer close(cell.granted)
	email, _ := generate.SeedAccount(cell.options.Seed)
	started := time.Now()
	var log bytes.Buffer
	for attempt := 1; ; attempt++ {
		command := exec.CommandContext(ctx, "node", "--experimental-transform-types", "src/main.ts", "grant-platform-operator", email) // #nosec G204 -- fixed argv.
		command.Dir, command.Env = filepath.Join(cell.options.HeadDir, "apps", "tasks"), cell.envWith(nil)
		out, err := command.CombinedOutput()
		fmt.Fprintf(&log, "--- attempt %d at %d ms\n%s", attempt, time.Since(started).Milliseconds(), out)
		_ = os.WriteFile(cell.logPath("grant-operator"), log.Bytes(), 0o600)
		took := time.Since(started)
		if err == nil {
			cell.report.Timings = append(cell.report.Timings, Timing{Step: "grant-operator", Ms: took.Milliseconds()})
			cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("grant-platform-operator: granted in %d ms, attempt %d", took.Milliseconds(), attempt))
			_ = os.WriteFile(filepath.Join(cell.options.RunDir, "operator.granted"), nil, 0o600) // the walk signs in again
			return
		}
		delay, again := operatorGrantRetry.wait(attempt, took, out)
		if !again || sleep(ctx, delay) != nil {
			cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("grant-platform-operator: gave up after %d attempts in %d ms: %s: %s", attempt, took.Milliseconds(), err, tail(out)))
			return
		}
	}
}
