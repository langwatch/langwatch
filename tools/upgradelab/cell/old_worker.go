package cell

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// DrillOldWorker (cloud gap G1-2): a rolling deploy leaves main's worker taking queued jobs after head
// upgraded the schema and took traffic. The paused worker resumes when head's worker starts, keeps
// running oldWorkerLinger past the switch with traffic on, then stops; the old writers are asserted
// gone only after it stopped. OW1 judges what it did meanwhile.
const DrillOldWorker = "old-worker-lingers"

const oldWorkerLinger = 5 * time.Minute

// oldWorkerState is what the lingering old worker drill measured.
type oldWorkerState struct {
	resumedMs, stoppedMs int64
	atResume, atStop     map[string]float64 // the worker's own group-queue job counters
	metricsErr           string
	deadAtResume         []string // dead-letter keys in Redis
	deadAtStop           []string
}

// keepOldWorker resumes main's paused worker instead of stopping it; answers whether the drill holds it.
func (cell *run) keepOldWorker(ctx context.Context) bool {
	if !cell.drill(DrillOldWorker) {
		return false
	}
	cell.proc("from-worker").Signal(syscall.SIGCONT)
	cell.mark("fromWorkerResumed")
	cell.oldWorker.resumedMs = cell.marks["fromWorkerResumed"]
	cell.oldWorker.deadAtResume, _ = deadLetterKeys(ctx, cell.stores.RedisPort)
	var err error
	if cell.oldWorker.atResume, err = workerJobCounters(ctx, cell.fromMetricsPort, cell.fromMetricsKey); err != nil {
		cell.oldWorker.metricsErr = err.Error()
	}
	return true
}

// lingerOldWorker holds main's worker until oldWorkerLinger after the switch, then stops it gracefully.
func (cell *run) lingerOldWorker(ctx context.Context) {
	if !cell.drill(DrillOldWorker) {
		return
	}
	until := cell.origin.Add(time.Duration(cell.marks["switched"])*time.Millisecond + oldWorkerLinger)
	_ = sleep(ctx, time.Until(until))
	var err error
	if cell.oldWorker.atStop, err = workerJobCounters(ctx, cell.fromMetricsPort, cell.fromMetricsKey); err != nil && cell.oldWorker.metricsErr == "" {
		cell.oldWorker.metricsErr = err.Error()
	}
	cell.oldWorker.deadAtStop, _ = deadLetterKeys(ctx, cell.stores.RedisPort)
	cell.proc("from-worker").Stop(20 * time.Second)
	cell.mark("fromWorkerStopped")
	cell.oldWorker.stoppedMs = cell.marks["fromWorkerStopped"]
}

// jobCounter matches a group-queue job counter line of a Prometheus scrape, labels summed away.
var jobCounter = regexp.MustCompile(`^(gq_jobs_[a-z_]+_total)(?:\{[^}]*\})?\s+([0-9.eE+-]+)$`)

// parseJobCounters sums each gq_jobs_*_total counter over its labels.
func parseJobCounters(scrape io.Reader) map[string]float64 {
	counters := map[string]float64{}
	scanner := bufio.NewScanner(scrape)
	scanner.Buffer(make([]byte, 1<<20), 1<<22)
	for scanner.Scan() {
		if match := jobCounter.FindStringSubmatch(strings.TrimSpace(scanner.Text())); match != nil {
			if value, err := strconv.ParseFloat(match[2], 64); err == nil {
				counters[match[1]] += value
			}
		}
	}
	return counters
}

// labMetricsKey is a throwaway bearer key for one cell's metrics door, never a real credential.
func labMetricsKey() string {
	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	return hex.EncodeToString(raw)
}

func workerJobCounters(ctx context.Context, port int, key string) (map[string]float64, error) {
	if port == 0 {
		return nil, errors.New("no worker metrics port")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:"+itoa(port)+"/metrics", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("worker metrics answered %d", response.StatusCode)
	}
	return parseJobCounters(response.Body), nil
}

// deadLetterKeys lists every dead-letter key of the cell's Redis; an empty set does not exist there.
func deadLetterKeys(ctx context.Context, port string) ([]string, error) {
	var keys []string
	for _, pattern := range []string{"*:gq:dlq*", "*dead-letter*", "*deadletter*"} {
		found, err := scanKeys(ctx, port, pattern)
		if err != nil {
			return keys, err
		}
		keys = append(keys, found...)
	}
	return keys, nil
}

// schemaSignatures are what a release says when it meets a table, column or type it does not know.
var schemaSignatures = []string{
	"does not exist", "P2021", "P2022", "Unknown identifier", "Missing columns", "There is no column", "Unknown column",
	"invalid input value for enum", "violates not-null constraint",
}

func schemaLine(line string) bool {
	for _, signature := range schemaSignatures {
		if strings.Contains(line, signature) {
			return true
		}
	}
	return false
}

// oldWorkerFindings reads main's worker log from fromMs (ms from origin) on: error lines, schema lines.
func oldWorkerFindings(log io.Reader, fromMs int64, origin time.Time) (errorLines, schema []string, lines int) {
	scanner := bufio.NewScanner(log)
	scanner.Buffer(make([]byte, 1<<20), 1<<22)
	for scanner.Scan() {
		line := scanner.Text()
		if epoch, ok := lineEpochMs(line); !ok || epoch-origin.UnixMilli() < fromMs {
			continue
		}
		lines++
		if isErrorLine(line) {
			errorLines = append(errorLines, fmt.Sprintf("%.240s", line))
		}
		if schemaLine(line) {
			schema = append(schema, fmt.Sprintf("%.240s", line))
		}
	}
	return errorLines, schema, lines
}

// schemaExceptionsSQL asks ClickHouse's query log for unknown table, column or identifier errors
// (codes 16, 47, 60) on the cell's database in a window; system tables the lab lacks are left out.
func schemaExceptionsSQL(database string, from, to time.Time) string {
	return fmt.Sprintf(`SELECT exception_code, count(), substring(any(exception), 1, 200) FROM system.query_log
WHERE type != 'QueryStart' AND exception_code IN (16, 47, 60) AND current_database = '%s'
  AND event_time BETWEEN toDateTime(%d) AND toDateTime(%d) AND query NOT ILIKE '%%system.backup_log%%'
GROUP BY exception_code, normalized_query_hash FORMAT TSV`, strings.ReplaceAll(database, "'", ""), from.Unix(), to.Unix())
}

// schemaExceptions answers each failing query shape in the window, from either release.
func (cell *run) schemaExceptions(ctx context.Context, fromMs, toMs int64) ([]string, error) {
	out, err := clickhouseQuery(ctx, cell.stores.ClickHouseBase+"/", schemaExceptionsSQL(cell.stores.Name, cell.origin.Add(time.Duration(fromMs)*time.Millisecond), cell.origin.Add(time.Duration(toMs)*time.Millisecond)))
	var found []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line != "" {
			found = append(found, line)
		}
	}
	return found, err
}

// oldWorkerVerdict (OW1): main's worker ran beside head on head's schema without an error or a schema
// line, did work, and left no dead letter and no exhausted job; N3, N4, I4 and I6 judge loss and reads.
func (cell *run) oldWorkerVerdict() Verdict {
	state := cell.oldWorker
	var errorLines, schema []string
	var lines int
	if file, err := os.Open(cell.logPath("from-worker")); err == nil {
		errorLines, schema, lines = oldWorkerFindings(file, state.resumedMs, cell.origin)
		_ = file.Close()
	}
	clickHouse, queryErr := cell.schemaExceptions(context.Background(), state.resumedMs, state.stoppedMs)
	delta := map[string]float64{}
	for name, value := range state.atStop {
		delta[name] = value - state.atResume[name]
	}
	newDead := len(state.deadAtStop) - len(state.deadAtResume)
	pass := state.resumedMs > 0 && state.stoppedMs > state.resumedMs && len(errorLines) == 0 && len(schema) == 0 && len(clickHouse) == 0 && queryErr == nil &&
		newDead <= 0 && delta["gq_jobs_exhausted_total"] == 0 && delta["gq_jobs_non_retryable_total"] == 0
	return verdict("OW1", pass, fmt.Sprintf("main's worker resumed at %d ms, switched at %d ms, stopped at %d ms; %d log lines since resume, %d error lines %v, %d schema lines %v; ClickHouse unknown table/column errors on the cell's database in the window (either release) %v%s; its job counters over the window %v%s; dead-letter keys at resume %v, at stop %v",
		state.resumedMs, cell.marks["switched"], state.stoppedMs, lines, len(errorLines), first(errorLines), len(schema), first(schema), clickHouse, errSuffix(errText(queryErr)), delta, errSuffix(state.metricsErr), state.deadAtResume, state.deadAtStop))
}
