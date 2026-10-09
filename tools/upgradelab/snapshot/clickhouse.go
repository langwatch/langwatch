package snapshot

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// ClickHouseTable is one entry of system.tables.
type ClickHouseTable struct {
	Name       string `json:"name"`
	Engine     string `json:"engine"`
	SortingKey string `json:"sorting_key"`
	Create     string `json:"create_table_query"`
}

// ClickHouse is one target database (shared or private-<label>).
type ClickHouse interface {
	Database() string
	Tables(ctx context.Context) ([]ClickHouseTable, error)
	Exec(ctx context.Context, statement string) error
	Export(ctx context.Context, table string, out io.Writer) error
	Import(ctx context.Context, table string, in io.Reader) error
	Cells(ctx context.Context, table string, visit func(Cell)) error
	Fingerprint(ctx context.Context, tables []ClickHouseTable) (map[string]TableFingerprint, error)
	Facts(ctx context.Context) (ClickHouseFacts, error)
}

// ClickHouseFacts are the manifest fields read from a target.
type ClickHouseFacts struct {
	ServerVersion string
	GooseVersion  int64
	Events        []EventCount
}

// DatabasePlaceholder stands for the target database in schema.sql.
const DatabasePlaceholder = "${CLICKHOUSE_DATABASE}"

func isView(engine string) bool {
	switch engine {
	case "View", "MaterializedView", "LiveView", "WindowView", "Dictionary":
		return true
	}
	return false
}

// splitViews parts data tables from views; a materialized view's .inner table is recreated by its view.
func splitViews(tables []ClickHouseTable) (data, views []ClickHouseTable) {
	for _, table := range tables {
		switch {
		case isView(table.Engine):
			views = append(views, table)
		case !strings.HasPrefix(table.Name, ".inner"):
			data = append(data, table)
		}
	}
	return data, views
}

func databaseReference(database string) *regexp.Regexp {
	return regexp.MustCompile("(^|[^A-Za-z0-9_.$])`?" + regexp.QuoteMeta(database) + "`?\\.")
}

// PortableCreate replaces the database name with the placeholder.
func PortableCreate(create, database string) string {
	return databaseReference(database).ReplaceAllString(create, "${1}"+strings.ReplaceAll(DatabasePlaceholder, "$", "$$")+".")
}

// LocalizeCreate puts a destination database in place of the placeholder.
func LocalizeCreate(create, database string) string {
	return strings.ReplaceAll(create, DatabasePlaceholder, database)
}

const statementMarker = "-- upgradelab: "

// SchemaSQL writes tables first and views last, each after a marker line naming it and its engine.
func SchemaSQL(database string, tables []ClickHouseTable) string {
	data, views := splitViews(tables)
	var out strings.Builder
	for _, table := range append(data, views...) {
		fmt.Fprintf(&out, "%s%s %s\n%s;\n\n", statementMarker, table.Name, table.Engine, PortableCreate(table.Create, database))
	}
	return out.String()
}

// ParseSchemaSQL reads SchemaSQL back.
func ParseSchemaSQL(text string) []ClickHouseTable {
	var tables []ClickHouseTable
	for _, block := range strings.Split(text, statementMarker)[1:] {
		header, body, _ := strings.Cut(block, "\n")
		name, engine, _ := strings.Cut(header, " ")
		tables = append(tables, ClickHouseTable{Name: name, Engine: engine, Create: strings.TrimSuffix(strings.TrimSpace(body), ";")})
	}
	return tables
}

var collapsingEngine = regexp.MustCompile(`(Replacing|Collapsing|Aggregating|Summing|Graphite)MergeTree`)

// FingerprintQuery folds a table by its sorting key, FINAL where the engine merges rows.
func FingerprintQuery(database string, table ClickHouseTable) string {
	key := table.SortingKey
	if key == "" || key == "tuple()" {
		key = "*"
	}
	final := ""
	if collapsingEngine.MatchString(table.Engine) {
		final = " FINAL"
	}
	return fmt.Sprintf("SELECT count(), toString(groupBitXor(cityHash64(%s))) FROM %s.`%s`%s FORMAT TSV", key, database, table.Name, final)
}

// ClickHouseHTTP talks to ClickHouse over its HTTP interface; nothing needs server config.
type ClickHouseHTTP struct {
	endpoint url.URL
	user     string
	password string
	database string
	client   *http.Client
}

// NewClickHouseHTTP reads http://user:password@host:8123/database.
func NewClickHouseHTTP(raw string) (*ClickHouseHTTP, error) {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("clickhouse url must be http(s)://user@host:port/database")
	}
	database := strings.TrimPrefix(parsed.Path, "/")
	if database == "" {
		return nil, fmt.Errorf("clickhouse url names no database")
	}
	password, _ := parsed.User.Password()
	store := &ClickHouseHTTP{user: parsed.User.Username(), password: password, database: database, client: http.DefaultClient}
	store.endpoint = url.URL{Scheme: parsed.Scheme, Host: parsed.Host, Path: "/"}
	return store, nil
}

// Database is the target database name.
func (clickhouse *ClickHouseHTTP) Database() string { return clickhouse.database }

// chRequest is one query; with a body, the query rides in the URL and the body is its data.
type chRequest struct {
	query  string
	body   io.Reader
	header http.Header
}

func (clickhouse *ClickHouseHTTP) post(ctx context.Context, call chRequest) (*http.Response, error) {
	query, body, header := call.query, call.body, call.header
	endpoint := clickhouse.endpoint
	params := url.Values{"database": {clickhouse.database}, "output_format_json_quote_64bit_integers": {"0"}}
	if body == nil {
		body = strings.NewReader(query)
	} else {
		params.Set("query", query)
	}
	if header.Get("Accept-Encoding") != "" {
		params.Set("enable_http_compression", "1")
	}
	endpoint.RawQuery = params.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), body)
	if err != nil {
		return nil, err
	}
	for name, values := range header {
		request.Header[name] = values
	}
	request.Header.Set("X-ClickHouse-User", clickhouse.user)
	request.Header.Set("X-ClickHouse-Key", clickhouse.password)
	response, err := clickhouse.client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode/100 != 2 {
		defer response.Body.Close()
		message, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return nil, fmt.Errorf("clickhouse %d: %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	return response, nil
}

func (clickhouse *ClickHouseHTTP) text(ctx context.Context, query string) (string, error) {
	response, err := clickhouse.post(ctx, chRequest{query: query})
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	return strings.TrimSpace(string(data)), err
}

// Exec runs one statement.
func (clickhouse *ClickHouseHTTP) Exec(ctx context.Context, statement string) error {
	_, err := clickhouse.text(ctx, statement)
	return err
}

// Tables lists the database's tables and views from system.tables, by name.
func (clickhouse *ClickHouseHTTP) Tables(ctx context.Context) ([]ClickHouseTable, error) {
	text, err := clickhouse.text(ctx, fmt.Sprintf("SELECT name, engine, sorting_key, create_table_query FROM system.tables WHERE database = '%s' AND NOT is_temporary ORDER BY name FORMAT JSONEachRow", clickhouse.database))
	if err != nil {
		return nil, err
	}
	var tables []ClickHouseTable
	for line := range strings.SplitSeq(text, "\n") {
		if line == "" {
			continue
		}
		var table ClickHouseTable
		if err := json.Unmarshal([]byte(line), &table); err != nil {
			return nil, err
		}
		tables = append(tables, table)
	}
	return tables, nil
}

// Export streams SELECT * FORMAT Native, compressed by the server with zstd.
func (clickhouse *ClickHouseHTTP) Export(ctx context.Context, table string, out io.Writer) error {
	response, err := clickhouse.post(ctx, chRequest{query: fmt.Sprintf("SELECT * FROM %s.`%s` FORMAT Native", clickhouse.database, table), header: http.Header{"Accept-Encoding": {"zstd"}}})
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if encoding := response.Header.Get("Content-Encoding"); encoding != "zstd" {
		return fmt.Errorf("export of %s came back %q-encoded, not zstd", table, encoding)
	}
	_, err = io.Copy(out, response.Body)
	return err
}

// Import sends a zstd Native file as INSERT ... FORMAT Native; the server decompresses it.
func (clickhouse *ClickHouseHTTP) Import(ctx context.Context, table string, in io.Reader) error {
	response, err := clickhouse.post(ctx, chRequest{query: fmt.Sprintf("INSERT INTO %s.`%s` FORMAT Native", clickhouse.database, table), body: in, header: http.Header{"Content-Encoding": {"zstd"}}})
	if err != nil {
		return err
	}
	return response.Body.Close()
}

// Cells streams a table as TSVWithNames for the scrub.
func (clickhouse *ClickHouseHTTP) Cells(ctx context.Context, table string, visit func(Cell)) error {
	response, err := clickhouse.post(ctx, chRequest{query: fmt.Sprintf("SELECT * FROM %s.`%s` FORMAT TSVWithNames", clickhouse.database, table)})
	if err != nil {
		return err
	}
	defer response.Body.Close()
	return TSVCells(table, bufio.NewReader(response.Body), visit)
}

// Fingerprint folds each table on the server with FingerprintQuery.
func (clickhouse *ClickHouseHTTP) Fingerprint(ctx context.Context, tables []ClickHouseTable) (map[string]TableFingerprint, error) {
	fingerprint := map[string]TableFingerprint{}
	for _, table := range tables {
		text, err := clickhouse.text(ctx, FingerprintQuery(clickhouse.database, table))
		if err != nil {
			return nil, fmt.Errorf("fingerprint %s: %w", table.Name, err)
		}
		var count int64
		var sum string
		if _, err := fmt.Sscan(text, &count, &sum); err != nil {
			return nil, fmt.Errorf("fingerprint %s: %w", table.Name, err)
		}
		hash, err := parseServerHash(sum)
		if err != nil {
			return nil, err
		}
		fingerprint[table.Name] = TableFingerprint{Count: count, Hash: hash}
	}
	return fingerprint, nil
}

// Facts reads the server version, the goose version and the event-log histogram.
func (clickhouse *ClickHouseHTTP) Facts(ctx context.Context) (ClickHouseFacts, error) {
	version, err := clickhouse.text(ctx, "SELECT version()")
	if err != nil {
		return ClickHouseFacts{}, err
	}
	facts := ClickHouseFacts{ServerVersion: version}
	tables, err := clickhouse.Tables(ctx)
	if err != nil {
		return facts, err
	}
	for _, table := range tables {
		switch table.Name {
		case "goose_db_version":
			facts.GooseVersion, err = clickhouse.gooseVersion(ctx)
		case "event_log":
			facts.Events, err = clickhouse.eventHistogram(ctx)
		}
		if err != nil {
			return facts, err
		}
	}
	return facts, nil
}

func (clickhouse *ClickHouseHTTP) gooseVersion(ctx context.Context) (int64, error) {
	text, err := clickhouse.text(ctx, fmt.Sprintf("SELECT max(version_id) FROM %s.goose_db_version WHERE is_applied", clickhouse.database))
	var version int64
	if err == nil {
		_, _ = fmt.Sscan(text, &version)
	}
	return version, err
}

func (clickhouse *ClickHouseHTTP) eventHistogram(ctx context.Context) ([]EventCount, error) {
	text, err := clickhouse.text(ctx, fmt.Sprintf("SELECT AggregateType AS aggregateType, EventType AS eventType, toString(EventVersion) AS eventVersion, count() AS count FROM %s.event_log GROUP BY 1, 2, 3 ORDER BY 1, 2, 3 FORMAT JSONEachRow", clickhouse.database))
	if err != nil {
		return nil, err
	}
	var events []EventCount
	for line := range strings.SplitSeq(text, "\n") {
		var bucket EventCount
		if line != "" && json.Unmarshal([]byte(line), &bucket) == nil {
			events = append(events, bucket)
		}
	}
	return events, nil
}
