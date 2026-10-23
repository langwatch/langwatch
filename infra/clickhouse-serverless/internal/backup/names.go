// Package backup takes native ClickHouse backups to the 'backups' disk: full
// and incremental, chained, from CronJobs or from the ch-config sidecar
// (ADR-185). Decisions are pure functions of what the system tables say.
package backup

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Mode is full or incremental.
type Mode string

const (
	Full        Mode = "full"
	Incremental Mode = "incremental"
)

// Modes in the order the sidecar handles them.
var Modes = []Mode{Full, Incremental}

// ParseMode accepts "full" or "incremental".
func ParseMode(s string) (Mode, error) {
	switch Mode(s) {
	case Full, Incremental:
		return Mode(s), nil
	}
	return "", fmt.Errorf("backup mode must be full or incremental, got %q", s)
}

// Disk is the backups disk the image renders when BACKUP_ENABLED is set.
const Disk = "backups"

const nameTimeLayout = "20060102T150405Z"

var (
	databasePattern = regexp.MustCompile(`^[A-Za-z0-9_]+$`)
	clusterPattern  = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)
	// A path on the backups disk: what restore accepts and list prints.
	pathPattern = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_./-]*$`)
	// Disk('backups', '<path>') as system.backups and backup_log name it.
	diskRefPattern = regexp.MustCompile(`^Disk\(\s*'([^'\\]*)'\s*,\s*'([^'\\]*)'\s*\)$`)
)

// ValidDatabase reports whether name can be a backed-up database.
func ValidDatabase(name string) error {
	if !databasePattern.MatchString(name) {
		return fmt.Errorf("database %q may hold only letters, digits and underscores", name)
	}
	return nil
}

// ValidPath reports whether p is a safe path on the backups disk.
func ValidPath(p string) error {
	if !pathPattern.MatchString(p) || strings.Contains(p, "..") {
		return fmt.Errorf("backup name %q may hold only letters, digits, _ . / - and no '..'", p)
	}
	return nil
}

// NewPath names a backup of db taken at t, as the earlier backup-data.sh did.
func NewPath(db string, mode Mode, t time.Time) string {
	return fmt.Sprintf("%s_%s_%s", db, mode, t.UTC().Format(nameTimeLayout))
}

// namePatterns are the names this package takes as backups of db:
// its own, and the "<mode>-YYYYMMDD_HHMMSS" names of earlier deployments,
// which carry no database and are taken to be of the configured one.
func namePatterns(db string, mode Mode) []string {
	return []string{
		regexp.QuoteMeta(db) + "_" + string(mode) + `_[0-9]{8}T[0-9]{6}Z/?`,
		string(mode) + `-[0-9]{8}_[0-9]{6}/?`,
	}
}

// pathRegexp matches a known path of db in mode; anchored.
func pathRegexp(db string, mode Mode) string {
	return `^(?:` + strings.Join(namePatterns(db, mode), "|") + `)$`
}

// nameRegexp is the same, wrapped in Disk('backups', ...), for SQL match().
func nameRegexp(db string, mode Mode) string {
	return `^Disk\(\s*'` + Disk + `'\s*,\s*'(?:` + strings.Join(namePatterns(db, mode), "|") + `)'\s*\)$`
}

// Classify reads a system.backups or backup_log name. ok is false for a
// name on another disk or one this package did not write.
func Classify(db, name string) (path string, mode Mode, ok bool) {
	m := diskRefPattern.FindStringSubmatch(name)
	if m == nil || m[1] != Disk {
		return "", "", false
	}
	for _, mode := range Modes {
		if regexp.MustCompile(pathRegexp(db, mode)).MatchString(m[2]) {
			return m[2], mode, true
		}
	}
	return "", "", false
}

// DiskPath reads the path out of any Disk('backups', ...) name.
func DiskPath(name string) (string, bool) {
	m := diskRefPattern.FindStringSubmatch(name)
	if m == nil || m[1] != Disk {
		return "", false
	}
	return m[2], true
}
