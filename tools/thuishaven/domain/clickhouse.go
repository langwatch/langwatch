package domain

import (
	"fmt"
	"strings"
)

// ClickHouseService is the routed name for a stack's ClickHouse: it always
// resolves (clickhouse.<slug>.langwatch.localhost), pointing at the one shared
// managed clickhouse-server. Per-worktree isolation is by database, not server —
// so the hostname is always defined even when this worktree runs no CH of its
// own, and a "wrong migration count" is impossible because each worktree reads
// and writes only its own database.
const ClickHouseService = "clickhouse"

// DatabaseForSlug maps a slug to this worktree's isolated ClickHouse database on
// the shared server. Slugs use '-' (invalid in a CH identifier); databases use
// '_' and an "lw_" prefix so the name always starts with a letter and matches
// ClickHouse's identifier grammar (the app's goose runner validates the same).
func DatabaseForSlug(slug string) string {
	return "lw_" + strings.ReplaceAll(slug, "-", "_")
}

// ClickHouseContainer is the fixed container name for the shared managed
// server — a machine-wide singleton, same story as ObservabilityContainer: a
// second worktree finds this one and reuses it rather than standing up a rival.
const ClickHouseContainer = "langwatch-clickhouse"

// ClickHouseImage is Altinity's Stable Build: a well-managed, LTS-backported
// ClickHouse image (as opposed to upstream's own release cadence). Chosen over
// running clickhouse-server as a native host binary so every contributor's setup
// is identical regardless of what (if anything) they have brew-installed, and
// over the previous native-binary adapter so the memory ceiling is enforced two
// ways: ClickHouse's own <max_server_memory_usage> AND a hard Docker cgroup
// limit, so a runaway query is OOM-killed by the container rather than swelling
// into the host.
const ClickHouseImage = "altinity/clickhouse-server:25.8.16.10002.altinitystable"

// ClickHouseUser/ClickHousePassword are the fixed local-dev credentials for the
// managed container. Unlike the earlier native-binary adapter (which had its own
// users.xml and could leave the default user passwordless), the Altinity image's
// bootstrap entrypoint requires CLICKHOUSE_PASSWORD to be set or it rejects the
// default user outright. "langwatch" matches the password compose.dev.yml's own
// (now-legacy) clickhouse service already used, so nothing new to remember.
const (
	ClickHouseUser     = "default"
	ClickHousePassword = "langwatch"
)

// ClickHouseLimits bound what the managed server may take from the host. Proven
// numbers: the 1GiB experiment (880MiB internal cap) was too tight for
// LangWatch's read/background query load (UI + governance syncs) and the UI
// blanked when queries hit the cap. 1.5GiB container / 1.35GiB internal handles
// inserts + queries comfortably.
type ClickHouseLimits struct {
	ContainerMemoryMB int   // Docker --memory / --memory-swap (hard ceiling, OOM-kills rather than swells)
	MaxServerMemory   int64 // <max_server_memory_usage> — ClickHouse's own soft ceiling, under the container's
	MarkCacheSize     int64 // <mark_cache_size> — kept small on purpose; the rest are zeroed below

	// LightweightLogsEnabled disables ClickHouse's high-volume self-telemetry
	// (NoisySystemLogs) and bounds what is left by SystemLogTTLDays. On stock
	// defaults these tables are unbounded: a laptop measured 610 MiB of them
	// after ~5 days of ordinary dev, 303 MiB of it text_log alone. haven already
	// caps memory two ways, so leaving log disk unbounded was the odd one out.
	LightweightLogsEnabled bool
	// SystemLogTTLDays bounds the system logs that survive LightweightLogsEnabled.
	// Ignored unless LightweightLogsEnabled is set.
	SystemLogTTLDays int
}

// EffectiveSystemLogTTLDays is SystemLogTTLDays with the zero-value fallback
// applied — the single place the fallback rule lives, shared by the rendered
// config and the retrofit statements so the two can never drift.
func (l ClickHouseLimits) EffectiveSystemLogTTLDays() int {
	if l.SystemLogTTLDays <= 0 {
		return DefaultSystemLogTTLDays
	}
	return l.SystemLogTTLDays
}

// NoisySystemLogs are the system tables LightweightLogsEnabled turns off: pure volume
// with no local-debugging value. text_log duplicates what the container already
// writes to stdout; the metric logs are sampled telemetry nobody reads on a dev
// box (asynchronous_metric_log alone reached 70M rows in the measurement above);
// trace_log and the profile logs only matter during deliberate profiling, which
// is what HAVEN_CLICKHOUSE_FULL_LOGS=1 is for.
var NoisySystemLogs = []string{
	"text_log",
	"trace_log",
	"metric_log",
	"asynchronous_metric_log",
	"processors_profile_log",
	"query_metric_log",
}

// KeptSystemLogs are the system tables LightweightLogsEnabled keeps, capped at
// SystemLogTTLDays. These are the ones actually worth reaching for locally:
// query_log answers "why was that slow", part_log explains merge behaviour, and
// error_log/crash_log are tiny and matter exactly when something broke.
var KeptSystemLogs = []string{
	"query_log",
	"part_log",
	"error_log",
	"crash_log",
}

// DefaultClickHouseLimits is the proven-in-production tuning: internal cap at
// 90% of the container ceiling (leaves ClickHouse's own bookkeeping overhead
// room before the container's hard limit bites), a modest 64MiB mark cache, and
// — set directly in the config template, not here — uncompressed/mmap/compiled-
// expression caches all zeroed, since none of them pull their weight at this
// scale and idle RSS is the whole point.
func DefaultClickHouseLimits() ClickHouseLimits {
	const containerMB = 1536 // 1.5 GiB
	return ClickHouseLimits{
		ContainerMemoryMB:      containerMB,
		MaxServerMemory:        int64(containerMB) * 9 / 10 * (1 << 20), // 1.35 GiB
		MarkCacheSize:          64 << 20,                                // 64 MiB
		LightweightLogsEnabled: true,
		SystemLogTTLDays:       DefaultSystemLogTTLDays,
	}
}

// DefaultSystemLogTTLDays is how long the kept system logs live. A week spans
// "it was slow last Thursday" without letting query_log grow without bound.
const DefaultSystemLogTTLDays = 7

// ClickHouseConfigFile is the config.d override haven mounts read-only into the
// container — additive to the image's own config.d, never replacing it.
const ClickHouseConfigFile = "zzz-thuis.xml"

// LegacyClickHouseConfigFiles are earlier names of ClickHouseConfigFile, removed
// from haven's home on write. The mount is a single named file, so a stale one
// is never mounted — but leaving it behind invites editing the wrong file.
var LegacyClickHouseConfigFiles = []string{"zzz-thuis-memory.xml"}

// RenderClickHouseConfig fills in the config.d memory-and-log-policy override.
// "thuis" — Dutch for "home" — names this the same way thuishaven does: proven
// on a long-running low-RAM home instance before landing here.
func RenderClickHouseConfig(l ClickHouseLimits) string {
	return fmt.Sprintf(clickHouseConfigTemplate, l.MaxServerMemory, l.MarkCacheSize, renderLogConfig(l))
}

// renderLogConfig emits the log section: remove="1" switches a system log
// table off (the documented way — this file sorts last in config.d, so it wins
// over the image's own), a <ttl> bounds the ones kept, and the <logger> block
// quiets the server log itself — the image's stock config logs at trace with a
// 1000M x 10 rotation in the container layer, which is pure disk on a dev box.
// Empty when LightweightLogsEnabled is off, leaving the image's stock behaviour
// untouched.
func renderLogConfig(l ClickHouseLimits) string {
	if !l.LightweightLogsEnabled {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n    <!-- lightweight logs: HAVEN_CLICKHOUSE_FULL_LOGS=1 restores the stock ones -->\n")
	b.WriteString("    <logger>\n")
	b.WriteString("        <level>warning</level>\n")
	b.WriteString("        <size>50M</size>\n")
	b.WriteString("        <count>2</count>\n")
	b.WriteString("    </logger>\n")
	for _, name := range NoisySystemLogs {
		fmt.Fprintf(&b, "    <%s remove=\"1\"/>\n", name)
	}
	for _, name := range KeptSystemLogs {
		fmt.Fprintf(&b, "    <%s><ttl>event_date + INTERVAL %d DAY</ttl></%s>\n", name, l.EffectiveSystemLogTTLDays(), name)
	}
	return b.String()
}

// SystemLogRetrofitStatements are the idempotent DDLs that bring an
// already-running server in line with the rendered config: the config governs
// table *creation*, so a server that predates the policy keeps its unbounded
// tables until the disabled ones are dropped (the server will not recreate
// them) and the kept ones are given the TTL. Empty when LightweightLogsEnabled
// is off. Derived from the same lists and TTL as renderLogConfig so the two
// can never drift.
func SystemLogRetrofitStatements(l ClickHouseLimits) []string {
	if !l.LightweightLogsEnabled {
		return nil
	}
	var stmts []string
	for _, name := range NoisySystemLogs {
		stmts = append(stmts, "DROP TABLE IF EXISTS system."+name)
	}
	for _, name := range KeptSystemLogs {
		stmts = append(stmts, fmt.Sprintf("ALTER TABLE system.%s MODIFY TTL event_date + INTERVAL %d DAY", name, l.EffectiveSystemLogTTLDays()))
	}
	return stmts
}

const clickHouseConfigTemplate = `<!-- generated by haven (thuishaven) — do not edit -->
<clickhouse>
    <max_server_memory_usage>%d</max_server_memory_usage>
    <mark_cache_size>%d</mark_cache_size>
    <uncompressed_cache_size>0</uncompressed_cache_size>
    <mmap_cache_size>0</mmap_cache_size>
    <compiled_expression_cache_size>0</compiled_expression_cache_size>
    <!-- background work sized for a small shared VM, not a dedicated server:
         the stock pools (16 merge threads, a 512-thread schedule pool) assume
         cores to spare, and on a few-core VM serving a dozen small stack
         databases they only contend with the queries they exist to serve.
         The merge_tree free-entries thresholds must shrink with the merge
         pool, or large merges and mutations are never scheduled at all. -->
    <max_concurrent_queries>32</max_concurrent_queries>
    <background_pool_size>8</background_pool_size>
    <background_common_pool_size>4</background_common_pool_size>
    <background_schedule_pool_size>64</background_schedule_pool_size>
    <background_buffer_flush_schedule_pool_size>4</background_buffer_flush_schedule_pool_size>
    <background_fetches_pool_size>2</background_fetches_pool_size>
    <background_move_pool_size>2</background_move_pool_size>
    <background_message_broker_schedule_pool_size>2</background_message_broker_schedule_pool_size>
    <background_distributed_schedule_pool_size>2</background_distributed_schedule_pool_size>
    <merge_tree>
        <number_of_free_entries_in_pool_to_lower_max_size_of_merge>4</number_of_free_entries_in_pool_to_lower_max_size_of_merge>
        <number_of_free_entries_in_pool_to_execute_mutation>4</number_of_free_entries_in_pool_to_execute_mutation>
        <!-- stock 25 exceeds the shrunk pool*ratio capacity (16), and the server
             REFUSES TO BOOT on that sanity check rather than warning -->
        <number_of_free_entries_in_pool_to_execute_optimize_entire_partition>4</number_of_free_entries_in_pool_to_execute_optimize_entire_partition>
    </merge_tree>
%s</clickhouse>
`

// --- ceiling assessment ------------------------------------------------------
//
// haven caps the ClickHouse it manages two ways (container cgroup + the config
// above). It manages nothing when LANGWATCH_HAVEN_CH=0, the documented
// no-container route — and there it used to say nothing at all about the server
// it was pointed at. A brew clickhouse-server with no <max_server_memory_usage>
// takes 90% of the machine by default; on 2026-09-09 that drove an 18 GiB
// laptop through its swap and the kernel watchdog panicked it. The policy below
// is what haven checks, so an uncapped server is loud rather than silent. It is
// deliberately pure: the managed container and an unmanaged server reach the
// same verdict, because the tier changes who applies a ceiling, never what
// counts as a safe one.

// DefaultClickHouseRAMRatio is what ClickHouse itself falls back to when
// max_server_memory_usage is unset — max_server_memory_usage_to_ram_ratio's own
// default. Named here because the fallback is the whole hazard: an absent
// ceiling reads as 0 in system.server_settings, which looks like "no limit
// configured" and behaves like "90% of the machine".
const DefaultClickHouseRAMRatio = 0.9

// MaxSafeClickHouseRAMShare is the largest share of a development machine's
// memory haven accepts as a ClickHouse ceiling without complaining. A dev box
// runs the editor, the browser, a node stack and the agents too; a database
// allowed a third of the machine still leaves the rest of the work somewhere to
// live. The managed container's own 1.5 GiB sits far under this on any machine
// haven runs on, so the threshold only ever fires on a server haven did not
// configure.
const MaxSafeClickHouseRAMShare = 0.35

// ClickHouseCeiling is what a running server will let itself grow to, as read
// from system.server_settings. It keeps the raw pair rather than one number
// because which half answers is exactly what an operator needs told.
type ClickHouseCeiling struct {
	// MaxServerMemoryUsage is <max_server_memory_usage> in bytes. 0 means the
	// setting is absent and the ratio below decides.
	MaxServerMemoryUsage int64
	// RAMRatio is <max_server_memory_usage_to_ram_ratio>. Zero or negative
	// reads as DefaultClickHouseRAMRatio.
	RAMRatio float64
}

// Implicit reports whether the ceiling comes from the ratio fallback rather
// than from a number the operator chose.
func (c ClickHouseCeiling) Implicit() bool { return c.MaxServerMemoryUsage <= 0 }

// EffectiveBytes is what the server may actually grow to on a machine holding
// hostRAM bytes of memory.
func (c ClickHouseCeiling) EffectiveBytes(hostRAM uint64) int64 {
	if c.MaxServerMemoryUsage > 0 {
		return c.MaxServerMemoryUsage
	}
	ratio := c.RAMRatio
	if ratio <= 0 {
		ratio = DefaultClickHouseRAMRatio
	}
	return int64(float64(hostRAM) * ratio)
}

// ClickHouseCeilingVerdict is the assessment of one server's ceiling against
// one machine. Unknown is set when the machine's memory could not be read, and
// Safe then stays true: haven does not cry wolf on a number it does not have.
type ClickHouseCeilingVerdict struct {
	Safe           bool
	Unknown        bool
	Implicit       bool
	EffectiveBytes int64
	SafeBytes      int64
	HostRAMBytes   int64
}

// AssessClickHouseCeiling judges one server's ceiling against the machine it
// runs on.
func AssessClickHouseCeiling(c ClickHouseCeiling, hostRAM uint64) ClickHouseCeilingVerdict {
	if hostRAM == 0 {
		return ClickHouseCeilingVerdict{Safe: true, Unknown: true, Implicit: c.Implicit()}
	}
	effective := c.EffectiveBytes(hostRAM)
	safeBytes := int64(float64(hostRAM) * MaxSafeClickHouseRAMShare)
	return ClickHouseCeilingVerdict{
		Safe:           effective <= safeBytes,
		Implicit:       c.Implicit(),
		EffectiveBytes: effective,
		SafeBytes:      safeBytes,
		HostRAMBytes:   int64(hostRAM),
	}
}

// Warning renders the operator-facing line for an unsafe verdict, and "" for a
// safe or unknown one so a caller can log it unconditionally. where names the
// server ("the managed ClickHouse", or a URL) so one sentence serves both tiers.
func (v ClickHouseCeilingVerdict) Warning(where string) string {
	if v.Safe {
		return ""
	}
	cause := "its ceiling is set that high explicitly"
	if v.Implicit {
		cause = fmt.Sprintf("it sets no max_server_memory_usage of its own, so ClickHouse defaults to %d%% of the machine", int(DefaultClickHouseRAMRatio*100))
	}
	return fmt.Sprintf(
		"%s may grow to %s of this machine's %s — past the %s haven treats as safe here; %s. "+
			"Give it a max_server_memory_usage in its own config.d and reload it, or let haven manage ClickHouse (drop LANGWATCH_HAVEN_CH=0).",
		where, HumanBytes(v.EffectiveBytes), HumanBytes(v.HostRAMBytes), HumanBytes(v.SafeBytes), cause)
}
