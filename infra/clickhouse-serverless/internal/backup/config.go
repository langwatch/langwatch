package backup

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/chclient"
)

// SidecarMode is what the sidecar does with backups (BACKUP_SIDECAR).
type SidecarMode string

const (
	// SidecarOff: no backups in the sidecar (the default).
	SidecarOff SidecarMode = "off"
	// SidecarRun: schedule and run backups on the elected runner.
	SidecarRun SidecarMode = "run"
	// SidecarObserve: elect, decide and export metrics, but never back up,
	// so it can run next to the CronJobs that do.
	SidecarObserve SidecarMode = "observe"
)

// Config is the backup configuration, from the environment.
type Config struct {
	Host     string // CLICKHOUSE_HOST
	HTTPPort int    // CLICKHOUSE_HTTP_PORT
	User     string // BACKUP_USER, else CLICKHOUSE_USER
	// PasswordFile: BACKUP_PASSWORD_FILE, else CLICKHOUSE_PASSWORD_FILE.
	PasswordFile string
	// envPassword is CLICKHOUSE_PASSWORD, which only one-shot commands take.
	envPassword string

	Database      string // BACKUP_DATABASE
	RetentionDays int    // BACKUP_RETENTION_DAYS
	StaleHours    int    // STALE_BACKUP_HOURS
	Cluster       string // BACKUP_CLUSTER
	MaxBandwidth  int64  // BACKUP_MAX_BANDWIDTH, bytes per second

	Sidecar             SidecarMode // BACKUP_SIDECAR
	FullSchedule        string      // BACKUP_FULL_SCHEDULE
	IncrementalSchedule string      // BACKUP_INCREMENTAL_SCHEDULE
	MetricsListen       string      // BACKUP_METRICS_LISTEN
	RunnerOrdinal       int         // BACKUP_RUNNER_ORDINAL
}

// Defaults that keep the earlier scripts' meaning.
const (
	DefaultDatabase            = "langwatch"
	DefaultRetentionDays       = 7
	DefaultStaleHours          = 3
	DefaultFullSchedule        = "0 */12 * * *"
	DefaultIncrementalSchedule = "0 * * * *"
	DefaultMetricsListen       = "127.0.0.1:8125"
)

// LoadConfig reads the configuration through getenv. It returns what it
// could parse along with any error, so the sidecar can still serve metrics.
func LoadConfig(getenv func(string) string) (Config, error) {
	c := Config{
		Host:                or(getenv("CLICKHOUSE_HOST"), "localhost"),
		User:                or(getenv("BACKUP_USER"), getenv("CLICKHOUSE_USER")),
		PasswordFile:        or(getenv("BACKUP_PASSWORD_FILE"), getenv("CLICKHOUSE_PASSWORD_FILE")),
		envPassword:         getenv("CLICKHOUSE_PASSWORD"),
		Database:            or(getenv("BACKUP_DATABASE"), DefaultDatabase),
		Cluster:             getenv("BACKUP_CLUSTER"),
		Sidecar:             SidecarMode(or(strings.ToLower(getenv("BACKUP_SIDECAR")), string(SidecarOff))),
		FullSchedule:        or(getenv("BACKUP_FULL_SCHEDULE"), DefaultFullSchedule),
		IncrementalSchedule: or(getenv("BACKUP_INCREMENTAL_SCHEDULE"), DefaultIncrementalSchedule),
		MetricsListen:       or(getenv("BACKUP_METRICS_LISTEN"), DefaultMetricsListen),
	}
	var errs []error
	intVar := func(name string, def int, min int) int {
		raw := getenv(name)
		if raw == "" {
			return def
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n < min {
			errs = append(errs, fmt.Errorf("%s must be an integer of at least %d, got %q", name, min, raw))
			return def
		}
		return n
	}
	c.HTTPPort = intVar("CLICKHOUSE_HTTP_PORT", 8123, 1)
	c.RetentionDays = intVar("BACKUP_RETENTION_DAYS", DefaultRetentionDays, 1)
	c.StaleHours = intVar("STALE_BACKUP_HOURS", DefaultStaleHours, 1)
	c.RunnerOrdinal = intVar("BACKUP_RUNNER_ORDINAL", 0, 0)
	if raw := getenv("BACKUP_MAX_BANDWIDTH"); raw != "" {
		// Digits only: the cap reaches SQL text.
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 0 || strings.TrimLeft(raw, "0123456789") != "" {
			errs = append(errs, fmt.Errorf("BACKUP_MAX_BANDWIDTH must be a non-negative integer (bytes per second), got %q", raw))
		} else {
			c.MaxBandwidth = n
		}
	}

	if err := ValidDatabase(c.Database); err != nil {
		errs = append(errs, fmt.Errorf("BACKUP_DATABASE: %w", err))
	}
	if c.Cluster != "" && !clusterPattern.MatchString(c.Cluster) {
		errs = append(errs, fmt.Errorf("BACKUP_CLUSTER %q may hold only letters, digits, _ . -", c.Cluster))
	}
	switch c.Sidecar {
	case SidecarOff, SidecarRun, SidecarObserve:
	default:
		errs = append(errs, fmt.Errorf("BACKUP_SIDECAR must be off, run or observe, got %q", c.Sidecar))
	}
	if c.Sidecar != SidecarOff {
		for name, expr := range map[string]string{"BACKUP_FULL_SCHEDULE": c.FullSchedule, "BACKUP_INCREMENTAL_SCHEDULE": c.IncrementalSchedule} {
			if _, err := ParseSchedule(expr); err != nil {
				errs = append(errs, fmt.Errorf("%s: %w", name, err))
			}
		}
		if _, _, err := net.SplitHostPort(c.MetricsListen); err != nil {
			errs = append(errs, fmt.Errorf("BACKUP_METRICS_LISTEN: %w", err))
		}
	}
	return c, errors.Join(errs...)
}

func or(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// Policy is the part of the configuration Decide applies.
func (c Config) Policy() Policy {
	return Policy{Database: c.Database, RetentionDays: c.RetentionDays, StaleHours: c.StaleHours}
}

// Credentials picks the login. The sidecar takes a password file only;
// a one-shot command also takes CLICKHOUSE_PASSWORD, as the scripts did.
func (c Config) Credentials(allowEnvPassword bool) (chclient.Credentials, error) {
	if c.User == "" {
		return nil, errors.New("set BACKUP_USER (or CLICKHOUSE_USER) to the ClickHouse user that runs backups")
	}
	if c.PasswordFile != "" {
		return chclient.PasswordFile{User: c.User, Path: c.PasswordFile}, nil
	}
	if allowEnvPassword && c.envPassword != "" {
		return chclient.Static{User: c.User, Password: c.envPassword}, nil
	}
	if allowEnvPassword {
		return nil, errors.New("set BACKUP_PASSWORD_FILE, CLICKHOUSE_PASSWORD_FILE or CLICKHOUSE_PASSWORD")
	}
	return nil, errors.New("set BACKUP_PASSWORD_FILE (or CLICKHOUSE_PASSWORD_FILE): the sidecar reads its password from a file only")
}

// BaseURL is the server's HTTP interface.
func (c Config) BaseURL() string {
	return "http://" + net.JoinHostPort(c.Host, strconv.Itoa(c.HTTPPort))
}
