package ingestionbench

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// chClient talks to ClickHouse over its HTTP interface.
//
// Deliberately not a driver dependency: the queries here are a handful of
// read-only aggregates returning JSONEachRow, which the HTTP interface serves
// directly. The native protocol would buy connection pooling and binary
// framing that a benchmark issuing a few dozen verification queries has no
// use for, at the cost of a dependency in the root module.
type chClient struct {
	endpoint string // scheme://host:port, no path, no credentials
	database string
	user     string
	password string
	http     *http.Client
}

// newCHClient parses a ClickHouse DSN of the form
// http://user:password@host:8123/database.
func newCHClient(dsn string) (*chClient, error) {
	parsed, err := url.Parse(dsn)
	if err != nil {
		return nil, fmt.Errorf("could not parse ClickHouse URL: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("ClickHouse URL needs a scheme and host, got %q", dsn)
	}

	client := &chClient{
		endpoint: parsed.Scheme + "://" + parsed.Host,
		database: strings.TrimPrefix(parsed.Path, "/"),
		// A verification query over a few hundred thousand rows on a
		// contended runner is slow but not unbounded; without a timeout a
		// stalled merge would hang the whole run past the job timeout with no
		// diagnostic.
		http: &http.Client{Timeout: 2 * time.Minute},
	}
	if parsed.User != nil {
		client.user = parsed.User.Username()
		client.password, _ = parsed.User.Password()
	}
	return client, nil
}

// formatParam renders a Go value as a ClickHouse HTTP query parameter.
//
// ClickHouse binds `param_x` values by parsing them as the type declared in
// the `{x:Type}` placeholder, so scalars go over the wire bare. Arrays are the
// exception: they must arrive in ClickHouse's own literal syntax, quoted and
// escaped, or a trace id containing a quote would end the literal early.
func formatParam(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case []string:
		quoted := make([]string, len(typed))
		for i, item := range typed {
			escaped := strings.ReplaceAll(item, `\`, `\\`)
			escaped = strings.ReplaceAll(escaped, `'`, `\'`)
			quoted[i] = "'" + escaped + "'"
		}
		return "[" + strings.Join(quoted, ",") + "]"
	default:
		return fmt.Sprint(typed)
	}
}

// queryJSON runs a query and decodes the JSONEachRow response into rows.
//
// rows must be a pointer to a slice; each NDJSON line is decoded into one
// element. An empty result set yields an empty slice, never an error.
func queryJSON(ctx context.Context, client *chClient, query string, params map[string]any, rows any) error {
	target, err := url.Parse(client.endpoint)
	if err != nil {
		return err
	}
	values := target.Query()
	if client.database != "" {
		values.Set("database", client.database)
	}
	values.Set("default_format", "JSONEachRow")
	for name, value := range params {
		values.Set("param_"+name, formatParam(value))
	}
	target.RawQuery = values.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), strings.NewReader(query))
	if err != nil {
		return err
	}
	if client.user != "" {
		request.SetBasicAuth(client.user, client.password)
	}

	response, err := client.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		// ClickHouse puts the actual parse/execution error in the body, so
		// surfacing only the status code would make every failure look alike.
		return fmt.Errorf("clickhouse %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}

	return decodeNDJSON(body, rows)
}

// decodeNDJSON decodes newline-delimited JSON into a pointer-to-slice.
func decodeNDJSON(body []byte, rows any) error {
	var lines []json.RawMessage
	scanner := bufio.NewScanner(bytes.NewReader(body))
	// Rows carry span attributes, so the default 64KB line cap is not enough.
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		lines = append(lines, append(json.RawMessage(nil), line...))
	}
	if err := scanner.Err(); err != nil {
		return err
	}

	// Re-encoding as a JSON array lets encoding/json do the reflection into
	// whatever concrete slice the caller passed.
	array, err := json.Marshal(lines)
	if err != nil {
		return err
	}
	return json.Unmarshal(array, rows)
}
