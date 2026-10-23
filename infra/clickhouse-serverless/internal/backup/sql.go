package backup

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Every SQL statement this package sends is built here. Identifiers are
// backquoted, literals single-quoted with escapes, and both validated first.

func quoteIdent(s string) string {
	return "`" + strings.NewReplacer(`\`, `\\`, "`", "\\`").Replace(s) + "`"
}

func quoteString(s string) string {
	return "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(s) + "'"
}

func diskRef(path string) string {
	return "Disk(" + quoteString(Disk) + ", " + quoteString(path) + ")"
}

// Tables names a system table locally, or on every replica of a cluster.
type Tables struct {
	Cluster string
}

// from is the FROM target and the SETTINGS a cluster read needs. A replica
// that is down is skipped: the log of any replica that is up names a base.
func (t Tables) from(table string) (string, string) {
	if t.Cluster == "" {
		return "system." + table, ""
	}
	return "clusterAllReplicas(" + quoteString(t.Cluster) + ", system." + table + ")", " SETTINGS skip_unavailable_shards = 1"
}

// BackupSQL starts a backup of db to path, chained on base when set. ASYNC:
// the server owns the backup, so the caller may die without stopping it.
func BackupSQL(db, path, base string, maxBandwidth int64) (string, error) {
	if err := ValidDatabase(db); err != nil {
		return "", err
	}
	if err := ValidPath(path); err != nil {
		return "", err
	}
	settings := []string{"id = " + quoteString(path)}
	if base != "" {
		if err := ValidPath(base); err != nil {
			return "", fmt.Errorf("base: %w", err)
		}
		settings = append(settings, "base_backup = "+diskRef(base))
	}
	if maxBandwidth < 0 {
		return "", fmt.Errorf("max_backup_bandwidth must not be negative")
	}
	// Throttles reads so a full cannot starve merges and replication.
	if maxBandwidth > 0 {
		settings = append(settings, "max_backup_bandwidth = "+strconv.FormatInt(maxBandwidth, 10))
	}
	return fmt.Sprintf("BACKUP DATABASE %s TO %s SETTINGS %s ASYNC",
		quoteIdent(db), diskRef(path), strings.Join(settings, ", ")), nil
}

// RestoreSQL starts a restore of db from path under the operation id.
func RestoreSQL(db, path, id string) (string, error) {
	if err := ValidDatabase(db); err != nil {
		return "", err
	}
	if err := ValidPath(path); err != nil {
		return "", err
	}
	return fmt.Sprintf("RESTORE DATABASE %s FROM %s SETTINGS id = %s, allow_non_empty_tables = true ASYNC",
		quoteIdent(db), diskRef(path), quoteString(id)), nil
}

// FlushLogsSQL writes pending backup_log rows, and creates the table on a
// server that has never logged a backup, so the cluster read finds it.
const FlushLogsSQL = "SYSTEM FLUSH LOGS"

// InFlightSQL lists backups still being written, on every replica.
func (t Tables) InFlightSQL() string {
	from, settings := t.from("backups")
	return "SELECT id, name, status, toUnixTimestamp(start_time) AS start_ts, hostName() AS host FROM " + from +
		" WHERE status = 'CREATING_BACKUP'" + settings
}

// CreatedSQL lists db's backups that completed after since, newest first.
func (t Tables) CreatedSQL(db string, since time.Time) string {
	from, settings := t.from("backup_log")
	return "SELECT id, name, status, toUnixTimestamp(start_time) AS start_ts, toUnixTimestamp(end_time) AS end_ts, total_size AS size_bytes, hostName() AS host FROM " + from +
		" WHERE status = 'BACKUP_CREATED' AND event_time >= toDateTime(" + strconv.FormatInt(since.Unix(), 10) + ")" +
		" AND (match(name, " + quoteString(nameRegexp(db, Full)) + ") OR match(name, " + quoteString(nameRegexp(db, Incremental)) + "))" +
		" ORDER BY end_ts DESC" + settings
}

// SummarySQL counts db's completed backups of mode ever, and the newest end.
func (t Tables) SummarySQL(db string, mode Mode) string {
	from, settings := t.from("backup_log")
	return "SELECT count() AS created, toUnixTimestamp(max(end_time)) AS last_end_ts FROM " + from +
		" WHERE status = 'BACKUP_CREATED' AND match(name, " + quoteString(nameRegexp(db, mode)) + ")" + settings
}

// StatusSQL reads one backup or restore by id from the in-memory table.
func (t Tables) StatusSQL(id string) string {
	from, settings := t.from("backups")
	return "SELECT id, name, status, error, toUnixTimestamp(start_time) AS start_ts, toUnixTimestamp(end_time) AS end_ts, total_size AS size_bytes, hostName() AS host FROM " + from +
		" WHERE id = " + quoteString(id) + settings
}

// LoggedStatusSQL reads the last logged state of id, for when a server
// restart emptied system.backups.
func (t Tables) LoggedStatusSQL(id string) string {
	from, settings := t.from("backup_log")
	return "SELECT id, name, status, error, toUnixTimestamp(start_time) AS start_ts, toUnixTimestamp(end_time) AS end_ts, total_size AS size_bytes, hostName() AS host FROM " + from +
		" WHERE id = " + quoteString(id) + " ORDER BY event_time_microseconds DESC LIMIT 1" + settings
}

// ListSQL lists every completed backup on the backups disk, newest first.
func (t Tables) ListSQL(limit int) string {
	from, settings := t.from("backup_log")
	return "SELECT id, name, status, toUnixTimestamp(start_time) AS start_ts, toUnixTimestamp(end_time) AS end_ts, total_size AS size_bytes, hostName() AS host FROM " + from +
		" WHERE status = 'BACKUP_CREATED' AND startsWith(name, " + quoteString("Disk("+quoteString(Disk)) + ")" +
		" ORDER BY end_ts DESC LIMIT " + strconv.Itoa(limit) + settings
}

// ReplicasSQL lists the cluster's replicas in order and marks this server.
func ReplicasSQL(cluster string) string {
	return "SELECT toUInt8(is_local) AS is_self, host_name AS host FROM system.clusters WHERE cluster = " +
		quoteString(cluster) + " ORDER BY shard_num, replica_num"
}

// ReachableSQL lists the replicas that answer, by 1-based position.
func ReachableSQL(cluster string) string {
	return "SELECT DISTINCT _shard_num AS replica_position FROM clusterAllReplicas(" + quoteString(cluster) +
		", system.one) SETTINGS skip_unavailable_shards = 1"
}
