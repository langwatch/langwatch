package seedgen

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
	"github.com/langwatch/langwatch/tools/havenrun"
)

// Sensor reads some of the guard's signals; an error skips its readings for that round.
type Sensor struct {
	Name string
	Read func(ctx context.Context) ([]Reading, error)
}

// StackSensors reads every signal the environment can reach: ClickHouse from CLICKHOUSE_URL,
// Redis from REDIS_URL, the worker backlog through app (the haven route), and host pressure.
func StackSensors(app string) []Sensor {
	sensors := []Sensor{{Name: "host", Read: readHostPressure}}
	if raw := os.Getenv("CLICKHOUSE_URL"); raw != "" {
		sensors = append(sensors, Sensor{Name: "clickhouse", Read: func(ctx context.Context) ([]Reading, error) {
			return readClickHouse(ctx, raw)
		}})
	}
	if raw := os.Getenv("REDIS_URL"); raw != "" {
		sensors = append(sensors, Sensor{Name: "redis", Read: func(ctx context.Context) ([]Reading, error) {
			return readRedis(ctx, raw)
		}})
	}
	if app != "" {
		op := &operator{app: strings.TrimRight(app, "/")}
		sensors = append(sensors, Sensor{Name: "worker", Read: op.backlog})
	}
	return sensors
}

// clickHouseQuery answers memory use over max_server_memory_usage (0 when uncapped) and the most
// active parts in one partition.
const clickHouseQuery = `SELECT
 (SELECT value FROM system.metrics WHERE metric = 'MemoryTracking') /
   greatest(1, (SELECT toFloat64(value) FROM system.server_settings WHERE name = 'max_server_memory_usage')),
 (SELECT toFloat64(value) FROM system.server_settings WHERE name = 'max_server_memory_usage'),
 (SELECT max(c) FROM (SELECT count() AS c FROM system.parts WHERE active GROUP BY database, table, partition))
FORMAT TSV`

func readClickHouse(ctx context.Context, raw string) ([]Reading, error) {
	fields, err := clickHouseRow(ctx, raw, clickHouseQuery)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: %w", err)
	}
	if len(fields) != 3 {
		return nil, fmt.Errorf("clickhouse: answered %q", fields)
	}
	values := make([]float64, 3)
	for i, field := range fields {
		values[i], _ = strconv.ParseFloat(field, 64)
	}
	readings := []Reading{{Signal: SignalClickHouseParts, Value: values[2]}}
	if values[1] > 0 {
		readings = append(readings, Reading{Signal: SignalClickHouseMemory, Value: values[0]})
	}
	return readings, nil
}

// clickHouseRow runs one query over ClickHouse's HTTP interface and returns its first TSV row.
func clickHouseRow(ctx context.Context, raw, query string) ([]string, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	target := url.URL{Scheme: parsed.Scheme, Host: parsed.Host, Path: "/"}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), strings.NewReader(query))
	if err != nil {
		return nil, err
	}
	if parsed.User != nil {
		password, _ := parsed.User.Password()
		request.SetBasicAuth(parsed.User.Username(), password)
	}
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	line, _, _ := strings.Cut(string(body), "\n")
	return strings.Split(line, "\t"), nil
}

// readRedis reads used_memory over maxmemory from INFO memory.
func readRedis(ctx context.Context, raw string) ([]Reading, error) {
	info, err := redisInfo(ctx, raw)
	if err != nil || info["maxmemory"] == 0 {
		return nil, err
	}
	return []Reading{{Signal: SignalRedisMemory, Value: info["used_memory"] / info["maxmemory"]}}, nil
}

// redisAuth sends AUTH when the URL carries a password.
func redisAuth(conn io.Writer, reader *bufio.Reader, user *url.Userinfo) error {
	password, ok := user.Password()
	if !ok {
		return nil
	}
	_, _ = io.WriteString(conn, strings.Join(strings.Fields("AUTH "+user.Username()+" "+password), " ")+"\r\n")
	if line, _ := reader.ReadString('\n'); !strings.HasPrefix(line, "+OK") {
		return errors.New("redis: AUTH refused")
	}
	return nil
}

// redisInfo sends INFO memory over RESP, after AUTH when the URL carries a password.
func redisInfo(ctx context.Context, raw string) (map[string]float64, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", parsed.Host)
	if err != nil {
		return nil, err
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	reader := bufio.NewReader(conn)
	if err := redisAuth(conn, reader, parsed.User); err != nil {
		return nil, err
	}
	_, _ = io.WriteString(conn, "INFO memory\r\n")
	header, err := reader.ReadString('\n')
	if err != nil || !strings.HasPrefix(header, "$") {
		return nil, fmt.Errorf("redis: INFO answered %q", header)
	}
	size, _ := strconv.Atoi(strings.TrimSpace(header[1:]))
	body := make([]byte, size+2)
	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, err
	}
	info := map[string]float64{}
	for line := range strings.SplitSeq(string(body), "\r\n") {
		if key, value, ok := strings.Cut(line, ":"); ok {
			info[key], _ = strconv.ParseFloat(value, 64)
		}
	}
	return info, nil
}

// readHostPressure maps macOS kern.memorystatus_vm_pressure_level (1, 2, 4) and Linux PSI
// (some/full avg10 ≥ 10) onto 0 normal, 1 warn, 2 critical.
func readHostPressure(ctx context.Context) ([]Reading, error) {
	var level float64
	var err error
	switch runtime.GOOS {
	case "darwin":
		level, err = darwinPressure(ctx)
	case "linux":
		level, err = linuxPressure()
	default:
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []Reading{{Signal: SignalHostPressure, Value: level}}, nil
}

func darwinPressure(ctx context.Context) (float64, error) {
	out, err := exec.CommandContext(ctx, "sysctl", "-n", "kern.memorystatus_vm_pressure_level").Output()
	return map[string]float64{"2": 1, "4": 2}[strings.TrimSpace(string(out))], err
}

func linuxPressure() (float64, error) {
	data, err := os.ReadFile("/proc/pressure/memory")
	level := 0.0
	for line := range strings.SplitSeq(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		if avg, _ := strconv.ParseFloat(strings.TrimPrefix(fields[1], "avg10="), 64); avg >= 10 {
			level = max(level, map[string]float64{"some": 1, "full": 2}[fields[0]])
		}
	}
	return level, err
}

// operator is the seeded admin's session, which reads ops.getDashboardSnapshot (the workerrun
// precedent, tools/workerrun/watch.go).
type operator struct {
	app    string
	client *http.Client
}

func (op *operator) backlog(ctx context.Context) ([]Reading, error) {
	if op.client == nil {
		if err := op.signIn(ctx); err != nil {
			return nil, err
		}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, op.app+"/api/trpc/ops.getDashboardSnapshot", nil)
	if err != nil {
		return nil, err
	}
	response, err := op.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	var envelope struct {
		Result struct {
			Data json.RawMessage `json:"data"`
		} `json:"result"`
	}
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if response.StatusCode != http.StatusOK || json.Unmarshal(raw, &envelope) != nil {
		op.client = nil // sign in again next round
		return nil, fmt.Errorf("ops.getDashboardSnapshot: status %d", response.StatusCode)
	}
	return decodeBacklog(envelope.Result.Data)
}

// decodeBacklog reads totalPendingJobs, under superjson's {"json": ...} if present.
func decodeBacklog(data json.RawMessage) ([]Reading, error) {
	var wrapped struct {
		JSON json.RawMessage `json:"json"`
	}
	if json.Unmarshal(data, &wrapped) == nil && len(wrapped.JSON) > 0 {
		data = wrapped.JSON
	}
	var snapshot struct {
		TotalPendingJobs float64 `json:"totalPendingJobs"`
	}
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return nil, fmt.Errorf("ops.getDashboardSnapshot: %w", err)
	}
	return []Reading{{Signal: SignalWorkerBacklog, Value: snapshot.TotalPendingJobs}}, nil
}

func (op *operator) signIn(ctx context.Context) error {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Timeout: 20 * time.Second, Jar: jar,
		Transport: &http.Transport{TLSClientConfig: havenrun.LocalTLSConfig()}}
	body, _ := json.Marshal(map[string]string{"email": diffkit.SeededAdminEmail, "password": diffkit.SeededAdminPassword})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, op.app+"/api/auth/sign-in/email", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", op.app)
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("operator sign-in: %w", err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("operator sign-in: status %d", response.StatusCode)
	}
	op.client = client
	return nil
}
