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

	// LightweightLogs disables ClickHouse's high-volume self-telemetry
	// (NoisySystemLogs) and bounds what is left by SystemLogTTLDays. On stock
	// defaults these tables are unbounded: a laptop measured 610 MiB of them
	// after ~5 days of ordinary dev, 303 MiB of it text_log alone. haven already
	// caps memory two ways, so leaving log disk unbounded was the odd one out.
	LightweightLogs bool
	// SystemLogTTLDays bounds the system logs that survive LightweightLogs.
	// Ignored unless LightweightLogs is set.
	SystemLogTTLDays int
}

// NoisySystemLogs are the system tables LightweightLogs turns off: pure volume
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

// KeptSystemLogs are the system tables LightweightLogs keeps, capped at
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
		ContainerMemoryMB: containerMB,
		MaxServerMemory:   int64(containerMB) * 9 / 10 * (1 << 20), // 1.35 GiB
		MarkCacheSize:     64 << 20,                                // 64 MiB
		LightweightLogs:   true,
		SystemLogTTLDays:  DefaultSystemLogTTLDays,
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

// RenderClickHouseConfig fills in the config.d memory-tuning override. "thuis" —
// Dutch for "home" — names this the same way thuishaven does: proven on a
// long-running low-RAM home instance before landing here.
func RenderClickHouseConfig(l ClickHouseLimits) string {
	return fmt.Sprintf(clickHouseConfigTemplate, l.MaxServerMemory, l.MarkCacheSize, renderLogConfig(l))
}

// renderLogConfig emits the log section: remove="1" switches a system log
// table off (the documented way — this file sorts last in config.d, so it wins
// over the image's own), a <ttl> bounds the ones kept, and the <logger> block
// quiets the server log itself — the image's stock config logs at trace with a
// 1000M x 10 rotation in the container layer, which is pure disk on a dev box.
// Empty when LightweightLogs is off, leaving the image's stock behaviour
// untouched.
func renderLogConfig(l ClickHouseLimits) string {
	if !l.LightweightLogs {
		return ""
	}
	ttlDays := l.SystemLogTTLDays
	if ttlDays <= 0 {
		ttlDays = DefaultSystemLogTTLDays
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
		fmt.Fprintf(&b, "    <%s><ttl>event_date + INTERVAL %d DAY</ttl></%s>\n", name, ttlDays, name)
	}
	return b.String()
}

const clickHouseConfigTemplate = `<!-- generated by haven (thuishaven) — do not edit -->
<clickhouse>
    <max_server_memory_usage>%d</max_server_memory_usage>
    <mark_cache_size>%d</mark_cache_size>
    <uncompressed_cache_size>0</uncompressed_cache_size>
    <mmap_cache_size>0</mmap_cache_size>
    <compiled_expression_cache_size>0</compiled_expression_cache_size>
%s</clickhouse>
`
