// Package clickhousehttp is what both managed-ClickHouse adapters (the
// container and the native host process) say to their server over its loopback
// HTTP port: liveness, the per-stack database DDL, the listings the daemon
// prunes from and the memory probe. One copy, so the two cannot drift.
package clickhousehttp

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Client reaches the server whose HTTP port Port reports (0 = not provisioned).
type Client struct {
	Port func() int
	// CPUs caps the root workload; 0 means this machine's core count.
	CPUs int
}

// Ping does not authenticate: /ping is a pre-auth liveness probe on every
// ClickHouse server regardless of credentials.
func (c Client) Ping(port int) bool {
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/ping", port), nil)
	if err != nil {
		return false
	}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode == http.StatusOK && strings.Contains(string(b), "Ok")
}

// WaitHealthy polls Ping until it answers or timeout passes.
func (c Client) WaitHealthy(ctx context.Context, port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if c.Ping(port) {
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("clickhouse did not become healthy within %s", timeout)
}

// EnsureDatabase creates a stack's database if it does not exist.
func (c Client) EnsureDatabase(ctx context.Context, database string) error {
	return c.Exec(ctx, "CREATE DATABASE IF NOT EXISTS "+quoteIdent(database))
}

// DropDatabase removes a stack's database, then the login and workload
// EnsureStackAccess made for it (absent ones are no error).
func (c Client) DropDatabase(ctx context.Context, database string) error {
	if err := c.Exec(ctx, "DROP DATABASE IF EXISTS "+quoteIdent(database)); err != nil {
		return err
	}
	return c.execAll(ctx, domain.ClickHouseDropStackAccessStatements(database))
}

// EnsureStackAccess declares the workload hierarchy, then the stack's own
// workload and login, capped at half the server's memory. Re-runnable: an
// existing login gets the password and settings again, an existing workload
// keeps its weight.
func (c Client) EnsureStackAccess(ctx context.Context, database, password string) error {
	cpus := c.CPUs
	if cpus <= 0 {
		cpus = runtime.NumCPU()
	}
	if err := c.execAll(ctx, domain.ClickHouseWorkloadHierarchyStatements(cpus)); err != nil {
		return err
	}
	memory := domain.ClickHouseStackUserMemory(c.maxServerMemory(ctx))
	return c.execAll(ctx, domain.ClickHouseStackAccessStatements(database, password, memory))
}

// SetStackWeight sets a provisioned stack's workload weight.
func (c Client) SetStackWeight(ctx context.Context, database string, weight int) error {
	return c.Exec(ctx, domain.ClickHouseStackWeightStatement(database, weight))
}

// maxServerMemory is the server's own memory ceiling, 0 when unreadable.
func (c Client) maxServerMemory(ctx context.Context) int64 {
	body, err := c.Query(ctx, "SELECT value FROM system.server_settings WHERE name = 'max_server_memory_usage' FORMAT TabSeparated")
	if err != nil {
		return 0
	}
	n, err := strconv.ParseInt(strings.TrimSpace(body), 10, 64)
	if err != nil {
		return 0
	}
	return n
}

func (c Client) execAll(ctx context.Context, statements []string) error {
	for _, sql := range statements {
		if err := c.Exec(ctx, sql); err != nil {
			return err
		}
	}
	return nil
}

// Databases lists the lw_* databases currently on the server.
func (c Client) Databases(ctx context.Context) ([]string, error) {
	body, err := c.Query(ctx, "SELECT name FROM system.databases WHERE name LIKE 'lw\\_%' ORDER BY name FORMAT TabSeparated")
	if err != nil {
		return nil, err
	}
	return splitLines(body), nil
}

// StrayDatabases lists test and bare langwatch databases whose newest
// table change is older than olderThan (a database with no tables counts as old).
func (c Client) StrayDatabases(ctx context.Context, olderThan time.Duration) ([]string, error) {
	body, err := c.Query(ctx, fmt.Sprintf(`SELECT d.name FROM system.databases d
LEFT JOIN (SELECT database, max(metadata_modification_time) AS m FROM system.tables GROUP BY database) t ON t.database = d.name
WHERE (d.name LIKE 'test\_%%' OR d.name = 'langwatch' OR d.name LIKE 'langwatch\_%%')
AND t.m < now() - INTERVAL %d SECOND ORDER BY d.name FORMAT TabSeparated`, int64(olderThan.Seconds())))
	if err != nil {
		return nil, err
	}
	return splitLines(body), nil
}

// MemoryResident is the server's resident memory, readable ("" if unknown).
func (c Client) MemoryResident(ctx context.Context) string {
	body, err := c.Query(ctx, "SELECT formatReadableSize(value) FROM system.asynchronous_metrics WHERE metric = 'MemoryResident' FORMAT TabSeparated")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(body)
}

// Exec runs a statement and discards its result.
func (c Client) Exec(ctx context.Context, sql string) error {
	_, err := c.Query(ctx, sql)
	return err
}

// Query authenticates as domain.ClickHouseUser: both servers require the local
// password for everything beyond /ping.
func (c Client) Query(ctx context.Context, sql string) (string, error) {
	port := c.Port()
	if port == 0 {
		return "", fmt.Errorf("clickhouse not provisioned")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/", port), bytes.NewReader([]byte(sql)))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(domain.ClickHouseUser, domain.ClickHousePassword)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("clickhouse query failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return string(body), nil
}

func splitLines(body string) []string {
	var out []string
	for _, line := range strings.Split(strings.TrimSpace(body), "\n") {
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

// quoteIdent backtick-quotes a ClickHouse identifier. haven only ever passes
// lw_<slug> names (validated upstream), but quoting keeps the DDL well-formed.
func quoteIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}
