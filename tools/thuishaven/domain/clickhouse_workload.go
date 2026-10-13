package domain

import (
	"fmt"
	"strings"
)

// The shared server schedules CPU by workload so no one stack can clog it: a
// root `all` capped at the machine's cores, background merges and mutations in
// `merges`, and every stack a leaf under `stacks`. Weights only bite under
// contention, so a lone stack still bursts to the whole cap.
const (
	ClickHouseRootWorkload   = "all"
	ClickHouseMergesWorkload = "merges"
	ClickHouseStacksWorkload = "stacks"
	// ClickHouseMergesMaxThreads caps background merges and mutations together.
	ClickHouseMergesMaxThreads = 2
	// StackWorkloadWeight is every stack's share; the focused one gets
	// FocusedStackWorkloadWeight, the worktree the developer is watching.
	StackWorkloadWeight        = 1
	FocusedStackWorkloadWeight = 3
	// ClickHouseStackPasswordKey is the stack's ClickHouse password in its
	// generated-credentials file; it travels only inside CLICKHOUSE_URL.
	ClickHouseStackPasswordKey = "HAVEN_CLICKHOUSE_STACK_PASSWORD"
)

// ClickHouseStackUserFor is the per-stack login that carries the stack's
// workload and memory cap: lw_<slug>_app beside LangWatchQL's lw_<slug>_lwql.
func ClickHouseStackUserFor(database string) string {
	return database + "_app"
}

// ClickHouseStackWorkloadFor is the stack's leaf workload, stack_<slug>.
func ClickHouseStackWorkloadFor(database string) string {
	return "stack_" + strings.TrimPrefix(database, "lw_")
}

// ClickHouseWorkloadHierarchyStatements declare the CPU resource and the shared
// workloads. Re-runnable: OR REPLACE keeps the caps in step with the machine,
// IF NOT EXISTS leaves the settingless parents alone. `default` catches every
// query that names no workload (the admin user, a stack not yet migrated).
func ClickHouseWorkloadHierarchyStatements(cpus int) []string {
	return []string{
		"CREATE RESOURCE IF NOT EXISTS cpu (MASTER THREAD, WORKER THREAD)",
		fmt.Sprintf("CREATE OR REPLACE WORKLOAD %s SETTINGS max_concurrent_threads = %d", quoteCHIdent(ClickHouseRootWorkload), max(cpus, 1)),
		fmt.Sprintf("CREATE OR REPLACE WORKLOAD %s IN %s SETTINGS max_concurrent_threads = %d",
			quoteCHIdent(ClickHouseMergesWorkload), quoteCHIdent(ClickHouseRootWorkload), ClickHouseMergesMaxThreads),
		fmt.Sprintf("CREATE WORKLOAD IF NOT EXISTS %s IN %s", quoteCHIdent(ClickHouseStacksWorkload), quoteCHIdent(ClickHouseRootWorkload)),
		fmt.Sprintf("CREATE WORKLOAD IF NOT EXISTS %s IN %s", quoteCHIdent("default"), quoteCHIdent(ClickHouseStacksWorkload)),
	}
}

// ClickHouseStackAccessStatements provision one stack's workload and login.
// The login holds what the app's own provisioning needs: everything on its
// database, the system tables, LangWatchQL's access model (users, policies,
// its named collection, the postgresql() bridge), each grantable, and its app
// functions (CREATE OR REPLACE FUNCTION asks CREATE and DROP FUNCTION).
// maxUserMemory 0 leaves the memory cap off.
func ClickHouseStackAccessStatements(database, password string, maxUserMemory int64) []string {
	user := quoteCHIdent(ClickHouseStackUserFor(database))
	workload := ClickHouseStackWorkloadFor(database)
	settings := fmt.Sprintf("PROFILE 'default', workload = %s", quoteCHString(workload))
	if maxUserMemory > 0 {
		settings += fmt.Sprintf(", max_memory_usage_for_user = %d", maxUserMemory)
	}
	identified := "IDENTIFIED WITH sha256_password BY " + quoteCHString(password)
	return []string{
		fmt.Sprintf("CREATE WORKLOAD IF NOT EXISTS %s IN %s SETTINGS weight = %d",
			quoteCHIdent(workload), quoteCHIdent(ClickHouseStacksWorkload), StackWorkloadWeight),
		fmt.Sprintf("CREATE USER IF NOT EXISTS %s %s", user, identified),
		fmt.Sprintf("ALTER USER %s %s SETTINGS %s", user, identified, settings),
		fmt.Sprintf("GRANT ALL ON %s.* TO %s WITH GRANT OPTION", quoteCHIdent(database), user),
		"GRANT SELECT ON system.* TO " + user,
		"GRANT ACCESS MANAGEMENT ON *.* TO " + user + " WITH GRANT OPTION",
		"GRANT POSTGRES ON *.* TO " + user + " WITH GRANT OPTION",
		"GRANT CURRENT GRANTS(NAMED COLLECTION ADMIN ON *) TO " + user + " WITH GRANT OPTION",
		"GRANT CREATE FUNCTION, DROP FUNCTION ON *.* TO " + user,
	}
}

// ClickHouseStackWeightStatement sets a provisioned stack's share.
func ClickHouseStackWeightStatement(database string, weight int) string {
	return fmt.Sprintf("CREATE OR REPLACE WORKLOAD %s IN %s SETTINGS weight = %d",
		quoteCHIdent(ClickHouseStackWorkloadFor(database)), quoteCHIdent(ClickHouseStacksWorkload), weight)
}

// ClickHouseDropStackAccessStatements remove what the access statements made,
// once the stack's database is gone.
func ClickHouseDropStackAccessStatements(database string) []string {
	return []string{
		"DROP USER IF EXISTS " + quoteCHIdent(ClickHouseStackUserFor(database)),
		"DROP WORKLOAD IF EXISTS " + quoteCHIdent(ClickHouseStackWorkloadFor(database)),
	}
}

// ClickHouseStackUserMemory is a stack login's memory cap: half the server's,
// so one stack can never take the server whole. 0 when the server has none.
func ClickHouseStackUserMemory(maxServerMemory int64) int64 {
	return maxServerMemory / 2
}

func quoteCHIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}

func quoteCHString(value string) string {
	return "'" + strings.ReplaceAll(strings.ReplaceAll(value, `\`, `\\`), "'", `\'`) + "'"
}
