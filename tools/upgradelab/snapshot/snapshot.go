package snapshot

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Stores is what a capture reads or a restore writes; a nil store is skipped.
type Stores struct {
	Postgres   Postgres
	ClickHouse map[string]ClickHouse
	Redis      Redis
	Objects    Objects
}

// DedicatedPrefix is the name every database a restore writes to must carry (ruling D7).
const DedicatedPrefix = "upgradelab_"

var dedicatedName = regexp.MustCompile(`^` + DedicatedPrefix + `[A-Za-z0-9_]+$`)

// CheckRestoreTarget refuses, before anything is written, any store not dedicated or not empty.
func CheckRestoreTarget(ctx context.Context, stores Stores) error {
	if err := checkPostgresTarget(ctx, stores.Postgres); err != nil {
		return err
	}
	if err := checkClickHouseTargets(ctx, stores.ClickHouse); err != nil {
		return err
	}
	if err := checkRedisTarget(ctx, stores.Redis); err != nil {
		return err
	}
	return checkObjectsTarget(ctx, stores.Objects)
}

func checkPostgresTarget(ctx context.Context, store Postgres) error {
	if store == nil {
		return nil
	}
	if err := checkDedicated("postgres", store.Database()); err != nil {
		return err
	}
	relations, err := store.RelationCount(ctx)
	if err != nil {
		return err
	}
	if relations > 0 {
		return fmt.Errorf("postgres database %q is not empty (%d relations): restore writes only into an empty dedicated database", store.Database(), relations)
	}
	return nil
}

func checkClickHouseTargets(ctx context.Context, targets map[string]ClickHouse) error {
	for _, target := range slices.Sorted(maps.Keys(targets)) {
		if err := checkClickHouseTarget(ctx, clickHouseTarget{name: target, store: targets[target]}); err != nil {
			return err
		}
	}
	return nil
}

type clickHouseTarget struct {
	name  string
	store ClickHouse
}

func checkClickHouseTarget(ctx context.Context, target clickHouseTarget) error {
	if err := checkDedicated("clickhouse/"+target.name, target.store.Database()); err != nil {
		return err
	}
	tables, err := target.store.Tables(ctx)
	if err != nil {
		return err
	}
	if len(tables) > 0 {
		return fmt.Errorf("clickhouse/%s database %q is not empty (%d tables): restore writes only into an empty dedicated database", target.name, target.store.Database(), len(tables))
	}
	return nil
}

func checkRedisTarget(ctx context.Context, store Redis) error {
	if store == nil {
		return nil
	}
	size, err := store.Size(ctx)
	if err != nil {
		return err
	}
	if size > 0 {
		return fmt.Errorf("redis database is not empty (%d keys): restore writes only into an empty database index", size)
	}
	return nil
}

func checkDedicated(store, database string) error {
	if !dedicatedName.MatchString(database) {
		return fmt.Errorf("%s database %q is not dedicated: restore writes only to a database named %s<name>, never a stack's own", store, database, DedicatedPrefix)
	}
	return nil
}

type fingerprintPart struct {
	name string
	take func(context.Context) (map[string]TableFingerprint, error)
}

// TakeFingerprint fingerprints every store given (plan §5.2).
func TakeFingerprint(ctx context.Context, stores Stores) (Fingerprint, error) {
	fingerprint := Fingerprint{}
	for _, part := range fingerprintParts(stores) {
		tables, err := part.take(ctx)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", part.name, err)
		}
		fingerprint[part.name] = tables
	}
	return fingerprint, nil
}

func fingerprintParts(stores Stores) []fingerprintPart {
	var parts []fingerprintPart
	if stores.Postgres != nil {
		parts = append(parts, fingerprintPart{name: "postgres", take: stores.Postgres.Fingerprint})
	}
	for target, store := range stores.ClickHouse {
		parts = append(parts, fingerprintPart{name: "clickhouse/" + target, take: clickHouseFingerprint(store)})
	}
	if stores.Redis != nil {
		parts = append(parts, fingerprintPart{name: "redis", take: redisFingerprint(stores.Redis)})
	}
	if stores.Objects != nil {
		parts = append(parts, fingerprintPart{name: "objects", take: objectsFingerprint(stores.Objects)})
	}
	return parts
}

func clickHouseFingerprint(store ClickHouse) func(context.Context) (map[string]TableFingerprint, error) {
	return func(ctx context.Context) (map[string]TableFingerprint, error) {
		tables, err := store.Tables(ctx)
		if err != nil {
			return nil, err
		}
		data, _ := splitViews(tables)
		return store.Fingerprint(ctx, data)
	}
}

func redisFingerprint(store Redis) func(context.Context) (map[string]TableFingerprint, error) {
	return func(ctx context.Context) (map[string]TableFingerprint, error) {
		keys, err := store.Keys(ctx)
		if err != nil {
			return nil, err
		}
		rows := make([][]string, 0, len(keys))
		for _, key := range keys {
			rows = append(rows, []string{key.Key, key.Type, base64.StdEncoding.EncodeToString(key.Dump)})
		}
		return map[string]TableFingerprint{"keys": FoldRows(rows)}, nil
	}
}

// CaptureInput is a capture's directory, sources, producer-given manifest fields and scrub.
type CaptureInput struct {
	Dir      string
	Stores   Stores
	Meta     Manifest
	Scrubber Scrubber
}

// Capture writes a snapshot of the stores into an empty directory. On any error, including a
// scrub finding, the directory is removed so no partial or secret-bearing snapshot remains.
func Capture(ctx context.Context, input CaptureInput) (Manifest, error) {
	if entries, err := os.ReadDir(input.Dir); err == nil && len(entries) > 0 {
		return Manifest{}, fmt.Errorf("capture directory %s is not empty", input.Dir)
	}
	if err := os.MkdirAll(input.Dir, 0o700); err != nil {
		return Manifest{}, err
	}
	manifest, err := capture(ctx, input)
	if err != nil {
		_ = os.RemoveAll(input.Dir)
		return Manifest{}, err
	}
	return manifest, nil
}

// captureStep is where one store's capture writes, what scrubs its cells and the manifest it fills.
type captureStep struct {
	dir      string
	visit    func(Cell)
	manifest *Manifest
}

func capture(ctx context.Context, input CaptureInput) (Manifest, error) {
	manifest := newManifest(input.Meta)
	seen := map[Finding]bool{}
	step := captureStep{dir: input.Dir, visit: func(cell Cell) { input.Scrubber.scan(cell, seen) }, manifest: &manifest}
	for _, run := range captureSteps(input.Stores, step) {
		if err := run(ctx); err != nil {
			return Manifest{}, err
		}
	}
	if len(seen) > 0 {
		return Manifest{}, &ScrubError{Findings: sortedFindings(seen)}
	}
	manifest.EventHistogram = mergeHistogram(manifest.EventHistogram)
	return finishCapture(ctx, input, manifest)
}

func newManifest(meta Manifest) Manifest {
	manifest := meta
	manifest.FormatVersion = FormatVersion
	manifest.ServerVersions, manifest.GooseVersions, manifest.RedisKeysByPrefix = map[string]string{}, map[string]int64{}, map[string]int{}
	manifest.Overlays, manifest.Expect.Steps = nonNil(manifest.Overlays), nonNil(manifest.Expect.Steps)
	manifest.PrismaMigrations, manifest.EventHistogram = []string{}, []EventCount{}
	return manifest
}

func captureSteps(stores Stores, step captureStep) []func(context.Context) error {
	var steps []func(context.Context) error
	if stores.Postgres != nil {
		steps = append(steps, func(ctx context.Context) error { return capturePostgres(ctx, stores.Postgres, step) })
	}
	for _, target := range slices.Sorted(maps.Keys(stores.ClickHouse)) {
		target := clickHouseTarget{name: target, store: stores.ClickHouse[target]}
		steps = append(steps, func(ctx context.Context) error { return captureClickHouseTarget(ctx, target, step) })
	}
	if stores.Redis != nil {
		steps = append(steps, func(ctx context.Context) error { return captureRedis(ctx, stores.Redis, step) })
	}
	if stores.Objects != nil {
		steps = append(steps, func(ctx context.Context) error { return captureObjects(ctx, stores.Objects, step) })
	}
	return steps
}

func finishCapture(ctx context.Context, input CaptureInput, manifest Manifest) (Manifest, error) {
	fingerprint, err := TakeFingerprint(ctx, input.Stores)
	if err != nil {
		return Manifest{}, err
	}
	manifest.Fingerprint = fingerprint
	if manifest.CreatedAt.IsZero() {
		manifest.CreatedAt = time.Now().UTC()
	}
	if manifest.SizeBytes, err = sizeOf(input.Dir); err != nil {
		return Manifest{}, err
	}
	if err := WriteManifestFile(input.Dir, manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, WriteChecksums(input.Dir)
}

// mergeHistogram sums the buckets every ClickHouse target reported, sorted by their names.
func mergeHistogram(buckets []EventCount) []EventCount {
	counts := map[EventCount]int64{}
	for _, bucket := range buckets {
		count := bucket.Count
		bucket.Count = 0
		counts[bucket] += count
	}
	merged := make([]EventCount, 0, len(counts))
	for bucket, count := range counts {
		bucket.Count = count
		merged = append(merged, bucket)
	}
	slices.SortFunc(merged, func(a, b EventCount) int {
		return strings.Compare(a.AggregateType+"\x00"+a.EventType+"\x00"+a.EventVersion, b.AggregateType+"\x00"+b.EventType+"\x00"+b.EventVersion)
	})
	return merged
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func capturePostgres(ctx context.Context, store Postgres, step captureStep) error {
	path := filepath.Join(step.dir, PostgresDump)
	if err := store.Dump(ctx, path); err != nil {
		return err
	}
	reader, writer := io.Pipe()
	go func() { writer.CloseWithError(store.Render(ctx, path, writer)) }()
	if err := CopyCells(reader, step.visit); err != nil {
		_ = reader.CloseWithError(err)
		return err
	}
	facts, err := store.Facts(ctx)
	if err != nil {
		return err
	}
	step.manifest.PostgresSchema, step.manifest.ServerVersions["postgres"] = store.Schema(), facts.ServerVersion
	step.manifest.PrismaMigrations = append(step.manifest.PrismaMigrations, facts.PrismaMigrations...)
	return nil
}

func captureClickHouseTarget(ctx context.Context, target clickHouseTarget, step captureStep) error {
	targetStep := step
	targetStep.dir = ClickHouseTargetDir(step.dir, target.name)
	if err := captureClickHouse(ctx, target.store, targetStep); err != nil {
		return fmt.Errorf("clickhouse/%s: %w", target.name, err)
	}
	facts, err := target.store.Facts(ctx)
	if err != nil {
		return fmt.Errorf("clickhouse/%s: %w", target.name, err)
	}
	step.manifest.ServerVersions["clickhouse/"+target.name], step.manifest.GooseVersions[target.name] = facts.ServerVersion, facts.GooseVersion
	step.manifest.EventHistogram = append(step.manifest.EventHistogram, facts.Events...)
	return nil
}

func captureClickHouse(ctx context.Context, store ClickHouse, step captureStep) error {
	tables, err := store.Tables(ctx)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(step.dir, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(step.dir, SchemaFile), []byte(SchemaSQL(store.Database(), tables)), 0o600); err != nil {
		return err
	}
	data, _ := splitViews(tables)
	for _, table := range data {
		if err := exportTable(ctx, store, tableFile{table: table.Name, path: filepath.Join(step.dir, NativeFile(table.Name))}); err != nil {
			return fmt.Errorf("%s: %w", table.Name, err)
		}
		if err := store.Cells(ctx, table.Name, step.visit); err != nil {
			return fmt.Errorf("%s: %w", table.Name, err)
		}
	}
	return nil
}

// tableFile is one ClickHouse table and the Native file its data travels in.
type tableFile struct {
	table, path string
}

func exportTable(ctx context.Context, store ClickHouse, target tableFile) error {
	file, err := os.OpenFile(target.path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err := store.Export(ctx, target.table, file); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func captureRedis(ctx context.Context, store Redis, step captureStep) error {
	keys, err := store.Keys(ctx)
	if err != nil {
		return err
	}
	var lines strings.Builder
	for _, key := range keys {
		line, err := json.Marshal(key)
		if err != nil {
			return err
		}
		lines.Write(append(line, '\n'))
		step.visit(Cell{Table: "redis", Column: key.Key, Value: string(key.Dump)})
		prefix, _, _ := strings.Cut(key.Key, ":")
		step.manifest.RedisKeysByPrefix[prefix]++
	}
	return os.WriteFile(filepath.Join(step.dir, RedisFile), []byte(lines.String()), 0o600)
}

// RestoreInput is a restore's snapshot directory and its empty, dedicated destinations.
type RestoreInput struct {
	Dir    string
	Stores Stores
}

// Restore loads a snapshot into stores that CheckRestoreTarget accepts. Every store the snapshot
// carries must be given a destination, so a restore is never silently partial.
func Restore(ctx context.Context, input RestoreInput) (Manifest, error) {
	manifest, err := checkRestore(ctx, input)
	if err != nil {
		return Manifest{}, err
	}
	for _, run := range restoreSteps(input, manifest) {
		if err := run(ctx); err != nil {
			return Manifest{}, err
		}
	}
	return manifest, nil
}

func checkRestore(ctx context.Context, input RestoreInput) (Manifest, error) {
	manifest, err := ReadManifestFile(input.Dir)
	if err != nil {
		return Manifest{}, err
	}
	if err := VerifyChecksums(input.Dir); err != nil {
		return Manifest{}, err
	}
	if err := checkCoverage(input.Dir, input.Stores); err != nil {
		return Manifest{}, err
	}
	return manifest, CheckRestoreTarget(ctx, input.Stores)
}

func restoreSteps(input RestoreInput, manifest Manifest) []func(context.Context) error {
	var steps []func(context.Context) error
	stores := input.Stores
	if stores.Postgres != nil {
		source := postgresSource{dump: filepath.Join(input.Dir, PostgresDump), schema: manifest.PostgresSchema}
		steps = append(steps, func(ctx context.Context) error { return restorePostgres(ctx, stores.Postgres, source) })
	}
	for target, store := range stores.ClickHouse {
		steps = append(steps, func(ctx context.Context) error {
			if err := restoreClickHouse(ctx, store, ClickHouseTargetDir(input.Dir, target)); err != nil {
				return fmt.Errorf("clickhouse/%s: %w", target, err)
			}
			return nil
		})
	}
	if stores.Redis != nil {
		steps = append(steps, func(ctx context.Context) error {
			return restoreRedis(ctx, stores.Redis, filepath.Join(input.Dir, RedisFile))
		})
	}
	if stores.Objects != nil {
		steps = append(steps, func(ctx context.Context) error {
			return restoreObjects(ctx, stores.Objects, filepath.Join(input.Dir, ObjectsFile))
		})
	}
	return steps
}

// postgresSource is the dump a restore loads and the schema it was taken from.
type postgresSource struct {
	dump, schema string
}

func restorePostgres(ctx context.Context, store Postgres, source postgresSource) error {
	if err := store.Restore(ctx, source.dump); err != nil {
		return err
	}
	for _, statement := range SchemaRenames(source.schema, store.Schema()) {
		if err := store.Exec(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func restoreRedis(ctx context.Context, store Redis, path string) error {
	keys, err := readRedisKeys(path)
	if err != nil {
		return err
	}
	return store.Restore(ctx, keys)
}

func checkCoverage(dir string, stores Stores) error {
	missing := missingFile(dir, PostgresDump, stores.Postgres == nil)
	missing = append(missing, missingFile(dir, RedisFile, stores.Redis == nil)...)
	missing = append(missing, missingFile(dir, ObjectsFile, stores.Objects == nil)...)
	entries, _ := os.ReadDir(filepath.Join(dir, ClickHouseDir))
	for _, entry := range entries {
		if _, ok := stores.ClickHouse[entry.Name()]; !ok {
			missing = append(missing, "clickhouse/"+entry.Name())
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("the snapshot carries %s but no destination was given for it", strings.Join(missing, ", "))
	}
	return nil
}

// missingFile names the snapshot file when it exists but no destination was given for it.
func missingFile(dir, name string, noDestination bool) []string {
	if _, err := os.Stat(filepath.Join(dir, name)); err != nil || !noDestination {
		return nil
	}
	return []string{name}
}

// restoreClickHouse creates tables, loads their data, then creates views, so a materialized view
// never fires on restored rows (plan §4.1).
func restoreClickHouse(ctx context.Context, store ClickHouse, dir string) error {
	text, err := os.ReadFile(filepath.Join(dir, SchemaFile))
	if err != nil {
		return err
	}
	data, views := splitViews(ParseSchemaSQL(string(text)))
	for _, table := range data {
		if err := store.Exec(ctx, LocalizeCreate(table.Create, store.Database())); err != nil {
			return fmt.Errorf("create %s: %w", table.Name, err)
		}
	}
	for _, table := range data {
		if err := importTable(ctx, store, tableFile{table: table.Name, path: filepath.Join(dir, NativeFile(table.Name))}); err != nil {
			return fmt.Errorf("load %s: %w", table.Name, err)
		}
	}
	for _, view := range views {
		if err := store.Exec(ctx, LocalizeCreate(view.Create, store.Database())); err != nil {
			return fmt.Errorf("create %s: %w", view.Name, err)
		}
	}
	return nil
}

func importTable(ctx context.Context, store ClickHouse, source tableFile) error {
	file, err := os.Open(source.path)
	if err != nil {
		return err
	}
	defer file.Close()
	return store.Import(ctx, source.table, file)
}

func readRedisKeys(path string) ([]RedisKey, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var keys []RedisKey
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 1<<20), 1<<30)
	for scanner.Scan() {
		var key RedisKey
		if err := json.Unmarshal(scanner.Bytes(), &key); err != nil {
			return nil, fmt.Errorf("%s: %w", RedisFile, err)
		}
		keys = append(keys, key)
	}
	return keys, scanner.Err()
}

// Verify compares the stores against the manifest's fingerprint; empty means equal.
func Verify(ctx context.Context, dir string, stores Stores) ([]string, error) {
	manifest, err := ReadManifestFile(dir)
	if err != nil {
		return nil, err
	}
	if err := VerifyChecksums(dir); err != nil {
		return nil, err
	}
	fingerprint, err := TakeFingerprint(ctx, stores)
	if err != nil {
		return nil, err
	}
	return manifest.Fingerprint.Diff(fingerprint), nil
}

// ErrDifferences is returned by the CLI when verify finds a difference.
var ErrDifferences = errors.New("the stores differ from the snapshot's fingerprint")
