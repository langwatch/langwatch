// Package snapshot is the upgrade snapshot format (plan-upgrade-snapshots §4): the layout of a
// snapshot directory, its manifest, the logical fingerprint, the secret scrub, and capture and
// restore over Postgres, ClickHouse and Redis behind small store interfaces.
package snapshot

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// FormatVersion is the snapshot format this package writes and reads.
const FormatVersion = 1

// The layout of a snapshot directory (plan §4.1).
const (
	ManifestFile  = "snapshot.json"
	PostgresDump  = "postgres.dump"
	ClickHouseDir = "clickhouse"
	SchemaFile    = "schema.sql"
	RedisFile     = "redis.jsonl"
	ObjectsFile   = "objects.tar.gz"
	ReadbackFile  = "readback.json"
	ChecksumsFile = "checksums.sha256"
)

// SchemaJSON is snapshot.schema.json; its top-level "required" list is the one the reader enforces.
//
//go:embed snapshot.schema.json
var SchemaJSON []byte

// Manifest is snapshot.json.
type Manifest struct {
	FormatVersion     int               `json:"formatVersion"`
	ID                string            `json:"id"`
	Recipe            Recipe            `json:"recipe"`
	Release           string            `json:"release"`
	Image             string            `json:"image"`
	Shape             Shape             `json:"shape"`
	Overlays          []string          `json:"overlays"`
	Seed              int64             `json:"seed"`
	Anchor            time.Time         `json:"anchor"`
	CreatedAt         time.Time         `json:"createdAt"`
	GeneratorCommit   string            `json:"generatorCommit"`
	PostgresSchema    string            `json:"postgresSchema"`
	ServerVersions    map[string]string `json:"serverVersions"`
	PrismaMigrations  []string          `json:"prismaMigrations"`
	GooseVersions     map[string]int64  `json:"gooseVersions"`
	Fingerprint       Fingerprint       `json:"fingerprint"`
	EventHistogram    []EventCount      `json:"eventHistogram"`
	RedisKeysByPrefix map[string]int    `json:"redisKeysByPrefix"`
	ObjectCount       int               `json:"objectCount"`
	Expect            Expect            `json:"expect"`
	SizeBytes         int64             `json:"sizeBytes"`
}

// Recipe names the generator that produced the state.
type Recipe struct {
	Version int    `json:"version"`
	Hash    string `json:"hash"`
}

// Shape is the deployment shape: non-secret env keys and values, and only the names of test secrets.
type Shape struct {
	Name        string            `json:"name"`
	Env         map[string]string `json:"env"`
	SecretNames []string          `json:"secretNames"`
}

// EventCount is one bucket of the event-log histogram.
type EventCount struct {
	AggregateType string `json:"aggregateType"`
	EventType     string `json:"eventType"`
	EventVersion  string `json:"eventVersion"`
	Count         int64  `json:"count"`
}

// Expect is what the upgrade from this snapshot must do.
type Expect struct {
	ExitCode int      `json:"exitCode"`
	Outcome  string   `json:"outcome"`
	Steps    []string `json:"steps"`
}

// requiredFields reads the schema's top-level "required" list.
func requiredFields() ([]string, error) {
	var schema struct {
		Required []string `json:"required"`
	}
	if err := json.Unmarshal(SchemaJSON, &schema); err != nil {
		return nil, fmt.Errorf("snapshot.schema.json: %w", err)
	}
	return schema.Required, nil
}

// ReadManifest refuses a manifest missing a required field, carrying an unknown one, or of another format.
func ReadManifest(data []byte) (Manifest, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return Manifest{}, fmt.Errorf("%s is not a JSON object: %w", ManifestFile, err)
	}
	required, err := requiredFields()
	if err != nil {
		return Manifest{}, err
	}
	var missing []string
	for _, field := range required {
		if _, ok := raw[field]; !ok {
			missing = append(missing, field)
		}
	}
	if len(missing) > 0 {
		return Manifest{}, fmt.Errorf("%s is missing required field(s): %s", ManifestFile, strings.Join(missing, ", "))
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var manifest Manifest
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, fmt.Errorf("%s: %w", ManifestFile, err)
	}
	if manifest.FormatVersion != FormatVersion {
		return Manifest{}, fmt.Errorf("%s has formatVersion %d; this upgradelab reads %d", ManifestFile, manifest.FormatVersion, FormatVersion)
	}
	return manifest, nil
}

// ReadManifestFile reads <dir>/snapshot.json.
func ReadManifestFile(dir string) (Manifest, error) {
	data, err := os.ReadFile(filepath.Join(dir, ManifestFile))
	if err != nil {
		return Manifest{}, err
	}
	return ReadManifest(data)
}

// WriteManifestFile writes <dir>/snapshot.json, indented, with a trailing newline.
func WriteManifestFile(dir string, manifest Manifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, ManifestFile), append(data, '\n'), 0o600)
}

// ClickHouseTargetDir is clickhouse/<target>/ (target = shared | private-<label>).
func ClickHouseTargetDir(dir, target string) string {
	return filepath.Join(dir, ClickHouseDir, target)
}

// NativeFile is a table's data file inside its target directory.
func NativeFile(table string) string { return table + ".native.zst" }

// WriteChecksums writes checksums.sha256 over every other file, sorted, in `sha256sum -c` form.
func WriteChecksums(dir string) error {
	sums, err := checksums(dir)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, ChecksumsFile), []byte(sums), 0o600)
}

// VerifyChecksums refuses a snapshot whose files differ from checksums.sha256.
func VerifyChecksums(dir string) error {
	want, err := os.ReadFile(filepath.Join(dir, ChecksumsFile))
	if err != nil {
		return err
	}
	got, err := checksums(dir)
	if err != nil {
		return err
	}
	if got != string(want) {
		return errors.New("snapshot files do not match " + ChecksumsFile)
	}
	return nil
}

func checksums(dir string) (string, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return "", err
	}
	defer root.Close()
	var lines []string
	err = fs.WalkDir(root.FS(), ".", func(rel string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || rel == ChecksumsFile {
			return err
		}
		sum, err := fileSum(root, rel)
		lines = append(lines, sum+"  "+rel+"\n")
		return err
	})
	slices.Sort(lines)
	return strings.Join(lines, ""), err
}

func fileSum(root *os.Root, rel string) (string, error) {
	file, err := root.Open(rel)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	_, err = io.Copy(hash, file)
	return hex.EncodeToString(hash.Sum(nil)), err
}

// sizeOf is the total size of the files under dir.
func sizeOf(dir string) (int64, error) {
	var total int64
	err := filepath.WalkDir(dir, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		info, err := entry.Info()
		if err == nil {
			total += info.Size()
		}
		return err
	})
	return total, err
}
