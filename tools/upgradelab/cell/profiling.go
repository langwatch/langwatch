package cell

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// profileDir holds a -profile cell's evidence: node CPU profiles and the samplers' TSVs. Absolute,
// since node writes it from each app's own directory.
func (cell *run) profileDir() string {
	dir, err := filepath.Abs(filepath.Join(cell.options.RunDir, "profile"))
	if err != nil {
		return filepath.Join(cell.options.RunDir, "profile")
	}
	return dir
}

// profileNodeOptions makes every node process the cell starts write a CPU profile when it exits.
func (cell *run) profileNodeOptions() string {
	return "--cpu-prof --cpu-prof-interval=10000 --cpu-prof-dir=" + filepath.Join(cell.profileDir(), "node")
}

// startProfiling samples processes every 15 s and Postgres activity every 5 s until the returned
// stop runs; stop then writes the Redis, Postgres and ClickHouse totals beside them.
func (cell *run) startProfiling(ctx context.Context) func() {
	if !cell.options.ProfilingEnabled {
		return func() {}
	}
	_ = os.MkdirAll(filepath.Join(cell.profileDir(), "node"), 0o750)
	started := time.Now()
	sampling, cancel := context.WithCancel(ctx)
	var wg sync.WaitGroup
	sample := func(name string, every time.Duration, read func(context.Context) string) {
		wg.Go(func() { cell.appendSamples(sampling, sampler{name: name, every: every, read: read}) })
	}
	sample("processes.tsv", 15*time.Second, sampleProcesses)
	sample("postgres-activity.tsv", 5*time.Second, cell.samplePostgresActivity)
	cell.writeProfile(ctx, "redis-commandstats-start.txt", cell.redisCommandStats(ctx))
	return func() {
		cancel()
		wg.Wait()
		final, done := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer done()
		cell.writeProfile(final, "redis-commandstats-end.txt", cell.redisCommandStats(final))
		cell.writeProfile(final, "postgres-tables.tsv", cell.postgresTableTotals(final))
		cell.writeProfile(final, "clickhouse-queries.tsv", cell.clickhouseQueryTotals(final, started))
	}
}

// sampler is one profile file: read's lines, appended every interval.
type sampler struct {
	name  string
	every time.Duration
	read  func(context.Context) string
}

func (cell *run) appendSamples(ctx context.Context, s sampler) {
	file, err := os.OpenFile(filepath.Join(cell.profileDir(), s.name), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer func() { _ = file.Close() }()
	for sleep(ctx, s.every) == nil {
		stamp := time.Now().Format("15:04:05")
		for line := range strings.SplitSeq(s.read(ctx), "\n") {
			if strings.TrimSpace(line) != "" {
				_, _ = fmt.Fprintf(file, "%s\t%s\n", stamp, line)
			}
		}
	}
}

func (cell *run) writeProfile(_ context.Context, name, body string) {
	_ = os.WriteFile(filepath.Join(cell.profileDir(), name), []byte(body), 0o600)
}

// credentials matches a URL's user:password, which a psql or node command line may carry.
var credentials = regexp.MustCompile(`://[^/@\s]+@`)

// sampleProcesses answers every process above 1% CPU: pid, CPU, resident MB and its command,
// with any URL credentials masked.
func sampleProcesses(ctx context.Context) string {
	out, err := exec.CommandContext(ctx, "ps", "-axo", "pid=,pcpu=,rss=,command=").Output() // #nosec G204 -- fixed argv.
	if err != nil {
		return ""
	}
	var rows []string
	for line := range strings.SplitSeq(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		var cpu float64
		var rss int
		_, _ = fmt.Sscan(fields[1], &cpu)
		_, _ = fmt.Sscan(fields[2], &rss)
		if cpu < 1 {
			continue
		}
		command := credentials.ReplaceAllString(strings.Join(fields[3:], " "), "://***@")
		rows = append(rows, fmt.Sprintf("%s\t%.1f\t%d\t%.160s", fields[0], cpu, rss/1024, command))
	}
	return strings.Join(rows, "\n")
}

// samplePostgresActivity answers the cell database's busy connections by state, wait and statement.
func (cell *run) samplePostgresActivity(ctx context.Context) string {
	out, _ := psql(ctx, cell.stores.psqlURL(), `SELECT state, coalesce(wait_event_type, '-'), coalesce(wait_event, '-'),
  count(*), round(max(extract(epoch FROM now() - query_start))::numeric, 2),
  left(regexp_replace(query, '\s+', ' ', 'g'), 140)
FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'
GROUP BY 1, 2, 3, 6 ORDER BY 4 DESC`)
	return strings.ReplaceAll(out, "|", "\t")
}

func (cell *run) postgresTableTotals(ctx context.Context) string {
	out, err := psql(ctx, cell.stores.psqlURL(), `SELECT schemaname || '.' || relname, seq_scan, seq_tup_read, idx_scan,
  n_tup_ins, n_tup_upd, n_tup_del, n_live_tup
FROM pg_stat_user_tables ORDER BY seq_tup_read + coalesce(idx_scan, 0) + n_tup_ins + n_tup_upd DESC LIMIT 60`)
	if err != nil {
		return err.Error()
	}
	return "table\tseq_scan\tseq_tup_read\tidx_scan\tinserted\tupdated\tdeleted\tlive\n" + strings.ReplaceAll(out, "|", "\t")
}

func (cell *run) redisCommandStats(ctx context.Context) string {
	out, err := exec.CommandContext(ctx, "redis-cli", "-p", cell.stores.RedisPort, "INFO", "commandstats").Output() // #nosec G204 -- fixed argv.
	if err != nil {
		return err.Error()
	}
	return string(out)
}

// clickhouseQueryTotals groups the run's finished queries by shape, slowest total first.
func (cell *run) clickhouseQueryTotals(ctx context.Context, since time.Time) string {
	_ = clickhouseExec(ctx, cell.stores.ClickHouseBase, "SYSTEM FLUSH LOGS")
	out, err := clickhouseQuery(ctx, cell.stores.ClickHouseBase+"/", fmt.Sprintf(`SELECT
  count() AS queries, round(sum(query_duration_ms) / 1000, 1) AS total_s, round(quantile(0.95)(query_duration_ms)) AS p95_ms,
  sum(read_rows) AS read_rows, sum(written_rows) AS written_rows, formatReadableSize(sum(memory_usage)) AS memory,
  substring(replaceRegexpAll(any(query), '\\s+', ' '), 1, 220) AS example
FROM system.query_log
WHERE type = 'QueryFinish' AND event_time >= toDateTime(%d) AND has(databases, '%s')
GROUP BY normalized_query_hash ORDER BY total_s DESC LIMIT 80
FORMAT TSVWithNames`, since.Unix(), cell.stores.Name))
	if err != nil {
		return err.Error()
	}
	return out
}
