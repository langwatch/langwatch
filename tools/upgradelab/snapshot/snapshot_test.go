package snapshot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"
)

type fakeTable struct {
	Columns []string
	Rows    [][]string
}

// fakePostgres dumps its tables as JSON and renders them as pg_restore's COPY text.
type fakePostgres struct {
	database, schema string
	tables           map[string]map[string]*fakeTable
	written          []string
}

func newFakePostgres(database, schema string) *fakePostgres {
	return &fakePostgres{database: database, schema: schema, tables: map[string]map[string]*fakeTable{}}
}

func seededPostgres(database, schema string) *fakePostgres {
	store := newFakePostgres(database, schema)
	store.tables[schema] = map[string]*fakeTable{
		"Project": {Columns: []string{"id", "name"}, Rows: [][]string{{"snap_p_1", "Snapshot Project 1"}, {"snap_p_2", "Snapshot Project 2"}}},
	}
	store.tables[LedgerSchema(schema)] = map[string]*fakeTable{"steps": {Columns: []string{"id"}, Rows: [][]string{{"user:record-created-facts"}}}}
	return store
}

func (store *fakePostgres) Database() string { return store.database }
func (store *fakePostgres) Schema() string   { return store.schema }

func (store *fakePostgres) Dump(_ context.Context, path string) error {
	data, err := json.Marshal(store.tables)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func (store *fakePostgres) Restore(_ context.Context, path string) error {
	store.written = append(store.written, "restore")
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &store.tables)
}

func (store *fakePostgres) Render(_ context.Context, path string, out io.Writer) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var tables map[string]map[string]*fakeTable
	if err := json.Unmarshal(data, &tables); err != nil {
		return err
	}
	for schema, byName := range tables {
		for name, table := range byName {
			quoted := make([]string, 0, len(table.Columns))
			for _, column := range table.Columns {
				quoted = append(quoted, quoteIdent(column))
			}
			fmt.Fprintf(out, "COPY %s.%s (%s) FROM stdin;\n", quoteIdent(schema), quoteIdent(name), strings.Join(quoted, ", "))
			for _, row := range table.Rows {
				fmt.Fprintln(out, strings.Join(row, "\t"))
			}
			fmt.Fprintln(out, `\.`)
		}
	}
	return nil
}

var renamePattern = regexp.MustCompile(`ALTER SCHEMA "([^"]+)" RENAME TO "([^"]+)"`)

func (store *fakePostgres) Exec(_ context.Context, statement string) error {
	store.written = append(store.written, statement)
	if match := renamePattern.FindStringSubmatch(statement); match != nil {
		if tables, ok := store.tables[match[1]]; ok {
			store.tables[match[2]] = tables
			delete(store.tables, match[1])
		}
	}
	return nil
}

func (store *fakePostgres) Fingerprint(context.Context) (map[string]TableFingerprint, error) {
	fingerprint := map[string]TableFingerprint{}
	for schema, byName := range store.tables {
		for name, table := range byName {
			if schema != store.schema {
				name = "upgrade_ledger." + name
			}
			fingerprint[name] = FoldRows(table.Rows)
		}
	}
	return fingerprint, nil
}

func (store *fakePostgres) Facts(context.Context) (PostgresFacts, error) {
	return PostgresFacts{ServerVersion: "16.4", PrismaMigrations: []string{"20240101000000_init"}}, nil
}

func (store *fakePostgres) RelationCount(context.Context) (int, error) {
	count := 0
	for _, byName := range store.tables {
		count += len(byName)
	}
	return count, nil
}

// fakeClickHouse fires a materialized view on every insert into its source, as the server does.
type fakeClickHouse struct {
	database string
	tables   []ClickHouseTable
	rows     map[string][][]string
	ops      []string
}

func newFakeClickHouse(database string) *fakeClickHouse {
	return &fakeClickHouse{database: database, rows: map[string][][]string{}}
}

func seededClickHouse(database string) *fakeClickHouse {
	store := newFakeClickHouse(database)
	_ = store.Exec(context.Background(), "CREATE TABLE "+database+".event_log (EventId String) ENGINE = ReplacingMergeTree")
	_ = store.Exec(context.Background(), "CREATE TABLE "+database+".spans (SpanId String) ENGINE = MergeTree")
	_ = store.Exec(context.Background(), "CREATE MATERIALIZED VIEW "+database+".spans_mv TO "+database+".spans_copy AS SELECT * FROM "+database+".spans")
	_ = store.Exec(context.Background(), "CREATE TABLE "+database+".spans_copy (SpanId String) ENGINE = MergeTree")
	store.insert("event_log", [][]string{{"evt_1"}, {"evt_2"}})
	store.insert("spans", [][]string{{"span_1"}, {"span_2"}, {"span_3"}})
	store.ops = nil
	return store
}

var (
	createPattern = regexp.MustCompile(`^CREATE (TABLE|MATERIALIZED VIEW) (\w+)\.(\w+)`)
	viewPattern   = regexp.MustCompile(`TO (\w+)\.(\w+) AS SELECT \* FROM (\w+)\.(\w+)`)
)

func (store *fakeClickHouse) Database() string { return store.database }

func (store *fakeClickHouse) Tables(context.Context) ([]ClickHouseTable, error) {
	return slices.Clone(store.tables), nil
}

func (store *fakeClickHouse) Exec(_ context.Context, statement string) error {
	match := createPattern.FindStringSubmatch(statement)
	if match == nil {
		return fmt.Errorf("fake clickhouse cannot run %q", statement)
	}
	engine := "MergeTree"
	if match[1] == "MATERIALIZED VIEW" {
		engine = "MaterializedView"
	}
	store.tables = append(store.tables, ClickHouseTable{Name: match[3], Engine: engine, Create: statement})
	store.ops = append(store.ops, "create "+match[3])
	return nil
}

func (store *fakeClickHouse) insert(table string, rows [][]string) {
	store.rows[table] = append(store.rows[table], rows...)
	for _, view := range store.tables {
		if match := viewPattern.FindStringSubmatch(view.Create); len(match) > 4 && match[4] == table {
			store.rows[match[2]] = append(store.rows[match[2]], rows...)
		}
	}
}

func (store *fakeClickHouse) Export(_ context.Context, table string, out io.Writer) error {
	return json.NewEncoder(out).Encode(store.rows[table])
}

func (store *fakeClickHouse) Import(_ context.Context, table string, in io.Reader) error {
	var rows [][]string
	if err := json.NewDecoder(in).Decode(&rows); err != nil {
		return err
	}
	store.ops = append(store.ops, "load "+table)
	store.insert(table, rows)
	return nil
}

func (store *fakeClickHouse) Cells(_ context.Context, table string, visit func(Cell)) error {
	for _, row := range store.rows[table] {
		for index, value := range row {
			visit(Cell{Table: table, Column: fmt.Sprint("c", index), Value: value})
		}
	}
	return nil
}

func (store *fakeClickHouse) Fingerprint(_ context.Context, tables []ClickHouseTable) (map[string]TableFingerprint, error) {
	fingerprint := map[string]TableFingerprint{}
	for _, table := range tables {
		fingerprint[table.Name] = FoldRows(store.rows[table.Name])
	}
	return fingerprint, nil
}

func (store *fakeClickHouse) Facts(context.Context) (ClickHouseFacts, error) {
	return ClickHouseFacts{ServerVersion: "25.8.1", GooseVersion: 77, Events: []EventCount{{AggregateType: "trace", EventType: "lw.trace.span_received", EventVersion: "2025-01-01", Count: 2}}}, nil
}

type fakeRedis struct{ keys []RedisKey }

func (store *fakeRedis) Keys(context.Context) ([]RedisKey, error) {
	return slices.Clone(store.keys), nil
}
func (store *fakeRedis) Size(context.Context) (int, error) { return len(store.keys), nil }
func (store *fakeRedis) Restore(_ context.Context, keys []RedisKey) error {
	store.keys = append(store.keys, keys...)
	return nil
}

func testMeta() Manifest {
	return Manifest{
		ID: "sh-free.3.20.1.typical.S.r1", Recipe: Recipe{Version: 1, Hash: "h"}, Release: "3.20.1", Image: "sha256:abc",
		Shape: Shape{Name: "sh-free", Env: map[string]string{"IS_SAAS": "false"}, SecretNames: []string{"CREDENTIALS_SECRET"}},
		Seed:  7, Anchor: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), Expect: Expect{Outcome: "upgraded"},
	}
}

func captureInto(t *testing.T, stores Stores, scrubber Scrubber) (string, Manifest, error) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "snap")
	manifest, err := Capture(context.Background(), CaptureInput{Dir: dir, Stores: stores, Meta: testMeta(), Scrubber: scrubber})
	return dir, manifest, err
}

// @scenario "A round trip gives an equal fingerprint"
func TestRoundTripGivesAnEqualFingerprint(t *testing.T) {
	source := Stores{
		Postgres:   seededPostgres("langwatch", "mydb"),
		ClickHouse: map[string]ClickHouse{"shared": seededClickHouse("langwatch"), "private-acme": seededClickHouse("langwatch_private")},
		Redis:      &fakeRedis{keys: []RedisKey{{Key: "bull:traces:1", Type: "hash", PTTL: -1, Dump: []byte{1, 2, 3}}}},
	}
	dir, manifest, err := captureInto(t, source, Scrubber{})
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	if manifest.Fingerprint["postgres"]["Project"].Count != 2 || manifest.RedisKeysByPrefix["bull"] != 1 || manifest.GooseVersions["shared"] != 77 {
		t.Fatalf("manifest misses measured fields: %+v", manifest)
	}
	restored := Stores{
		Postgres:   newFakePostgres("upgradelab_pg", "public"),
		ClickHouse: map[string]ClickHouse{"shared": newFakeClickHouse("upgradelab_shared"), "private-acme": newFakeClickHouse("upgradelab_acme")},
		Redis:      &fakeRedis{},
	}
	if _, err := Restore(context.Background(), RestoreInput{Dir: dir, Stores: restored}); err != nil {
		t.Fatalf("restore: %v", err)
	}
	diffs, err := Verify(context.Background(), dir, restored)
	if err != nil || len(diffs) > 0 {
		t.Fatalf("restored fingerprint differs: %v %v", err, diffs)
	}
	rows := [][]string{{"a", "1"}, {"b", "2"}, {"c", "3"}}
	if FoldRows(rows) != FoldRows([][]string{rows[2], rows[0], rows[1]}) {
		t.Fatal("fingerprint depends on row order")
	}
	if FoldRows(rows) == FoldRows(rows[:2]) {
		t.Fatal("fingerprint ignores a missing row")
	}
}

// @scenario "Materialized views are created after data, so restored rows are not counted twice"
func TestViewsAreCreatedAfterData(t *testing.T) {
	source := seededClickHouse("langwatch")
	if len(source.rows["spans_copy"]) != 3 {
		t.Fatalf("seed: view did not fire: %v", source.rows["spans_copy"])
	}
	dir, _, err := captureInto(t, Stores{ClickHouse: map[string]ClickHouse{"shared": source}}, Scrubber{})
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	schema, _ := os.ReadFile(filepath.Join(ClickHouseTargetDir(dir, "shared"), SchemaFile))
	if strings.Contains(string(schema), "langwatch.") || !strings.Contains(string(schema), DatabasePlaceholder+".spans_copy") {
		t.Fatalf("schema.sql keeps the source database name:\n%s", schema)
	}
	restored := newFakeClickHouse("upgradelab_shared")
	if _, err := Restore(context.Background(), RestoreInput{Dir: dir, Stores: Stores{ClickHouse: map[string]ClickHouse{"shared": restored}}}); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if got := len(restored.rows["spans_copy"]); got != 3 {
		t.Fatalf("view destination holds %d rows, want 3", got)
	}
	view := slices.Index(restored.ops, "create spans_mv")
	for index, op := range restored.ops {
		if strings.HasPrefix(op, "load ") && index > view || strings.HasPrefix(op, "create ") && op != "create spans_mv" && index > slices.Index(restored.ops, "load event_log") {
			t.Fatalf("restore order is not tables, data, views: %v", restored.ops)
		}
	}
}

// @scenario "Restoring a dump from schema mydb into schema public carries the ledger schema with it"
func TestSchemaRenameCarriesTheLedger(t *testing.T) {
	statements := strings.Join(SchemaRenames("mydb", "public"), "\n")
	for _, want := range []string{`ALTER SCHEMA "mydb" RENAME TO "public"`, `ALTER SCHEMA "mydb_upgrade_ledger" RENAME TO "public_upgrade_ledger"`} {
		if !strings.Contains(statements, want) {
			t.Fatalf("renames miss %q:\n%s", want, statements)
		}
	}
	if len(SchemaRenames("public", "public")) != 0 {
		t.Fatal("same schema should need no rename")
	}
	dir, _, err := captureInto(t, Stores{Postgres: seededPostgres("langwatch", "mydb")}, Scrubber{})
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	restored := newFakePostgres("upgradelab_pg", "public")
	if _, err := Restore(context.Background(), RestoreInput{Dir: dir, Stores: Stores{Postgres: restored}}); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if _, ok := restored.tables["public_upgrade_ledger"]["steps"]; !ok || restored.tables["mydb"] != nil {
		t.Fatalf("schemas after restore: %v", slices.Sorted(func(yield func(string) bool) {
			for name := range restored.tables {
				if !yield(name) {
					return
				}
			}
		}))
	}
}

// @scenario "Restore refuses a database that is not empty or not dedicated"
func TestRestoreRefusesNonDedicatedOrNonEmpty(t *testing.T) {
	dir, _, err := captureInto(t, Stores{Postgres: seededPostgres("langwatch", "public")}, Scrubber{})
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	own := newFakePostgres("langwatch", "public")
	_, err = Restore(context.Background(), RestoreInput{Dir: dir, Stores: Stores{Postgres: own}})
	if err == nil || !strings.Contains(err.Error(), DedicatedPrefix) {
		t.Fatalf("own stack not refused by name: %v", err)
	}
	busy := seededPostgres("upgradelab_busy", "public")
	_, err = Restore(context.Background(), RestoreInput{Dir: dir, Stores: Stores{Postgres: busy}})
	if err == nil || !strings.Contains(err.Error(), "not empty") {
		t.Fatalf("non-empty database not refused: %v", err)
	}
	if len(own.written)+len(busy.written) > 0 {
		t.Fatalf("a refused restore wrote: %v %v", own.written, busy.written)
	}
	shared := Stores{ClickHouse: map[string]ClickHouse{"shared": newFakeClickHouse("langwatch")}}
	if err := CheckRestoreTarget(context.Background(), shared); err == nil {
		t.Fatal("a non-dedicated clickhouse database was accepted")
	}
}

// @scenario "Scrub refuses a planted provider key, naming table and column but never the value"
func TestScrubRefusesPlantedKey(t *testing.T) {
	key := "sk-proj-" + strings.Repeat("A1b2", 8)
	allowed := "sk-test-" + strings.Repeat("x", 24)
	store := newFakePostgres("langwatch", "mydb")
	store.tables["mydb"] = map[string]*fakeTable{
		"ModelProvider": {Columns: []string{"id", "customKeys"}, Rows: [][]string{{"mp_1", `{"OPENAI_API_KEY":"` + key + `"}`}}},
		"TestFixture":   {Columns: []string{"id", "testKey"}, Rows: [][]string{{"tf_1", `"` + allowed + `"`}}},
	}
	dir, _, err := captureInto(t, Stores{Postgres: store}, Scrubber{Allow: []string{allowed}})
	var scrubError *ScrubError
	if !errors.As(err, &scrubError) {
		t.Fatalf("scrub did not refuse: %v", err)
	}
	if len(scrubError.Findings) != 1 || !strings.Contains(err.Error(), "ModelProvider.customKeys") {
		t.Fatalf("findings: %v", err)
	}
	if strings.Contains(err.Error(), key) || strings.Contains(err.Error(), "A1b2") {
		t.Fatal("the refusal leaks the key")
	}
	if _, statErr := os.Stat(dir); !os.IsNotExist(statErr) {
		t.Fatal("a refused snapshot directory was left behind")
	}
}

// @scenario "A manifest missing a field is refused"
func TestManifestMissingFieldIsRefused(t *testing.T) {
	manifest := testMeta()
	manifest.FormatVersion = FormatVersion
	data, _ := json.Marshal(manifest)
	if _, err := ReadManifest(data); err != nil {
		t.Fatalf("complete manifest refused: %v", err)
	}
	var raw map[string]any
	_ = json.Unmarshal(data, &raw)
	delete(raw, "anchor")
	partial, _ := json.Marshal(raw)
	if _, err := ReadManifest(partial); err == nil || !strings.Contains(err.Error(), "anchor") {
		t.Fatalf("missing anchor not refused by name: %v", err)
	}
	required, _ := requiredFields()
	fields := reflect.TypeFor[Manifest]()
	for index := range fields.NumField() {
		if tag := strings.Split(fields.Field(index).Tag.Get("json"), ",")[0]; !slices.Contains(required, tag) {
			t.Errorf("snapshot.schema.json does not require %q", tag)
		}
	}
}

// fakeObjects is a bucket held in memory.
type fakeObjects struct {
	bucket  string
	objects map[string][]byte
}

func (store *fakeObjects) Bucket() string { return store.bucket }

func (store *fakeObjects) List(context.Context) ([]string, error) {
	return slices.Collect(maps.Keys(store.objects)), nil
}

func (store *fakeObjects) Get(_ context.Context, key string) ([]byte, error) {
	return store.objects[key], nil
}

func (store *fakeObjects) Put(_ context.Context, object Object) error {
	if store.objects == nil {
		store.objects = map[string][]byte{}
	}
	store.objects[object.Key] = object.Body
	return nil
}

// @scenario "S3 objects travel with their keys, and a planted key in a body is refused"
func TestObjectsTravelWithTheirKeys(t *testing.T) {
	source := &fakeObjects{bucket: "langwatch", objects: map[string][]byte{
		"datasets/proj_1/rows.jsonl":   []byte(`{"input":"hello"}`),
		"traces/proj_1/2026/10/09.bin": {0, 1, 2, 255},
	}}
	dir, manifest, err := captureInto(t, Stores{Objects: source}, Scrubber{})
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	if manifest.ObjectCount != 2 {
		t.Fatalf("objectCount = %d, want 2", manifest.ObjectCount)
	}
	if _, err := Restore(context.Background(), RestoreInput{Dir: dir, Stores: Stores{Objects: &fakeObjects{bucket: "langwatch"}}}); err == nil || !strings.Contains(err.Error(), DedicatedBucketPrefix) {
		t.Fatalf("restore into the stack's own bucket was not refused by name: %v", err)
	}
	restored := &fakeObjects{bucket: "upgradelab-objects"}
	if _, err := Restore(context.Background(), RestoreInput{Dir: dir, Stores: Stores{Objects: restored}}); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if !reflect.DeepEqual(restored.objects, source.objects) {
		t.Fatalf("restored objects differ: %v", restored.objects)
	}
	if diffs, err := Verify(context.Background(), dir, Stores{Objects: restored}); err != nil || len(diffs) > 0 {
		t.Fatalf("restored fingerprint differs: %v %v", err, diffs)
	}
	key := "sk-proj-" + strings.Repeat("A1b2", 8)
	planted := &fakeObjects{bucket: "langwatch", objects: map[string][]byte{"exports/config.json": []byte(`{"key":"` + key + `"}`)}}
	_, _, err = captureInto(t, Stores{Objects: planted}, Scrubber{})
	var scrub *ScrubError
	if !errors.As(err, &scrub) || !strings.Contains(err.Error(), "exports/config.json") || strings.Contains(err.Error(), key) {
		t.Fatalf("planted key: want a refusal naming the object key, never the value; got %v", err)
	}
}
