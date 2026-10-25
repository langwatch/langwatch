package render

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

// mergeTreeConfig maps to the ClickHouse merge_tree section in limits.yaml.
type mergeTreeConfig struct {
	MinBytesForWidePart               int64 `yaml:"min_bytes_for_wide_part"`
	MinRowsForWidePart                int   `yaml:"min_rows_for_wide_part"`
	PartsToDelayInsert                int   `yaml:"parts_to_delay_insert"`
	PartsToThrowInsert                int   `yaml:"parts_to_throw_insert"`
	MaxBytesToMergeAtMaxSpaceInPool   int64 `yaml:"max_bytes_to_merge_at_max_space_in_pool"`
	MaxBytesToMergeAtMinSpaceInPool   int64 `yaml:"max_bytes_to_merge_at_min_space_in_pool"`
	MaxPartsToMergeAtOnce             int   `yaml:"max_parts_to_merge_at_once"`
	VerticalMergeMinRowsToActivate    int   `yaml:"vertical_merge_algorithm_min_rows_to_activate"`
	VerticalMergeMinColumnsToActivate int   `yaml:"vertical_merge_algorithm_min_columns_to_activate"`
	MergeWithTTLTimeout               int   `yaml:"merge_with_ttl_timeout"`
	MergeSelectingSleepMs             int   `yaml:"merge_selecting_sleep_ms"`
	FreeEntriesMutation               int   `yaml:"number_of_free_entries_in_pool_to_execute_mutation"`
	FreeEntriesLowerMerge             int   `yaml:"number_of_free_entries_in_pool_to_lower_max_size_of_merge"`
	FreeEntriesOptimize               int   `yaml:"number_of_free_entries_in_pool_to_execute_optimize_entire_partition"`
	MergeMaxBlockSizeBytes            int64 `yaml:"merge_max_block_size_bytes,omitempty"`

	// On-disk format pins that keep parts readable by 25.x, so an install
	// that upgraded to 26.8 can still roll back to an older image. Lifting
	// them is the moment rollback closes. 26.3 turned on the newer String
	// serialization inside Array/Map/Nested (ClickHouse #94859), which is
	// exactly the span event and link attribute columns; 26.8 writes
	// lightweight-UPDATE patch parts in a v2 format (#103182). 25.10
	// refuses to start on some of these settings, which is safe only
	// because they are rendered by the same image as the 26.8 binary.
	PropagateTypesSerializationVersionsToNestedTypes int    `yaml:"propagate_types_serialization_versions_to_nested_types"`
	EscapeIndexFilenames                             int    `yaml:"escape_index_filenames"`
	SerializationInfoVersion                         string `yaml:"serialization_info_version"`
	StringSerializationVersion                       string `yaml:"string_serialization_version"`
	PatchPartsVersion                                string `yaml:"patch_parts_version"`
	// 26.8 packs skip indices into one file per part (#111816); versions
	// before 26.6 then skip them when pruning, so a rollback reads slower.
	PackedSkipIndexMaxBytes int `yaml:"packed_skip_index_max_bytes"`
	// 26.4 builds column statistics in every merge (26.7: basic, uniq_v2).
	// A table setting, so compatibility leaves it on; keep merges as they were.
	AutoStatisticsTypes string `yaml:"auto_statistics_types"`
}

// systemLogDef defines a ClickHouse system log table with its configuration knobs.
type systemLogDef struct {
	key     string
	enabled bool
	ttl     int
	flush   int
	extra   map[string]any
}

// renderLimits writes limits.yaml containing MergeTree settings and system log configuration.
func renderLimits(input *config.Input, c *config.Computed, configD string) error {
	cfg := map[string]any{
		"merge_tree": &mergeTreeConfig{
			MinBytesForWidePart:               c.MinBytesForWidePart,
			MinRowsForWidePart:                c.MinRowsForWidePart,
			PartsToDelayInsert:                c.PartsToDelayInsert,
			PartsToThrowInsert:                c.PartsToThrowInsert,
			MaxBytesToMergeAtMaxSpaceInPool:   c.MaxBytesToMergeAtMaxSpace,
			MaxBytesToMergeAtMinSpaceInPool:   c.MaxBytesToMergeAtMinSpace,
			MaxPartsToMergeAtOnce:             c.MaxPartsToMergeAtOnce,
			VerticalMergeMinRowsToActivate:    c.VerticalMergeMinRows,
			VerticalMergeMinColumnsToActivate: c.VerticalMergeMinColumns,
			MergeWithTTLTimeout:               c.MergeWithTTLTimeout,
			MergeSelectingSleepMs:             c.MergeSelectingSleepMs,
			FreeEntriesMutation:               c.PoolFreeEntryMutation,
			FreeEntriesLowerMerge:             c.PoolFreeEntryLowerMerge,
			FreeEntriesOptimize:               c.PoolFreeEntryOptimizePartition,
			MergeMaxBlockSizeBytes:            c.MergeMaxBlockSizeBytes,

			PropagateTypesSerializationVersionsToNestedTypes: 0,
			EscapeIndexFilenames:                             0,
			SerializationInfoVersion:                         "basic",
			StringSerializationVersion:                       "single_stream",
			PatchPartsVersion:                                "v1",
			PackedSkipIndexMaxBytes:                          0,
			AutoStatisticsTypes:                              "",
		},
		// 26.8 folds per-disk, per-device and per-CPU asynchronous metrics
		// into one labelled metric (#115333). legacy_names keeps the names
		// dashboards and alerts read, such as DiskUsed_default.
		"asynchronous_metrics_key_values_mode":          "legacy_names",
		"max_server_memory_usage":                       c.MaxServerMemoryUsage,
		"max_server_memory_usage_to_ram_ratio":          c.MaxServerMemoryRatio,
		"max_concurrent_queries":                        c.MaxConcurrentQueries,
		"max_concurrent_select_queries":                 c.MaxConcurrentSelectQueries,
		"uncompressed_cache_size":                       c.UncompressedCacheSize,
		"background_pool_size":                          c.BackgroundPoolSize,
		"background_merges_mutations_concurrency_ratio": c.ConcurrencyRatio,
		// Hold the hard memory limit at the static cap. Otherwise MemoryWorker
		// re-derives it each tick from (RSS + MemAvailable) times
		// max_server_memory_usage_to_ram_ratio, which can shrink it below
		// max_server_memory_usage.
		"memory_worker_dynamic_hard_limit": 0,
	}

	if c.MaxTempDataOnDisk != 0 {
		cfg["max_temporary_data_on_disk_size"] = c.MaxTempDataOnDisk
	}

	// Small-pod budget: zero means "keep the ClickHouse default".
	for key, v := range map[string]int64{
		"mark_cache_size":                              c.MarkCacheSize,
		"index_mark_cache_size":                        c.IndexMarkCacheSize,
		"primary_index_cache_size":                     c.PrimaryIndexCacheSize,
		"query_condition_cache_size":                   c.QueryConditionCacheSize,
		"compiled_expression_cache_size":               c.CompiledExpressionCacheSize,
		"mmap_cache_size":                              int64(c.MmapCacheSize),
		"background_schedule_pool_size":                int64(c.BackgroundSchedulePoolSize),
		"background_common_pool_size":                  int64(c.BackgroundCommonPoolSize),
		"background_move_pool_size":                    int64(c.BackgroundMovePoolSize),
		"background_message_broker_schedule_pool_size": int64(c.BackgroundBrokerPoolSize),
		"background_distributed_schedule_pool_size":    int64(c.BackgroundDistPoolSize),
		"background_buffer_flush_schedule_pool_size":   int64(c.BackgroundBufferPoolSize),
		"background_fetches_pool_size":                 int64(c.BackgroundFetchesPoolSize),
		"max_thread_pool_free_size":                    int64(c.MaxThreadPoolFreeSize),
	} {
		if v != 0 {
			cfg[key] = v
		}
	}
	if c.MergesMemoryRatio != 0 {
		cfg["merges_mutations_memory_usage_to_ram_ratio"] = c.MergesMemoryRatio
	}

	// System logs — table-driven configuration.
	defaultTTL := input.SystemLogTTLDays
	logs := []systemLogDef{
		{"query_log", input.EnableQueryLog, input.QueryLogTTLDays, input.QueryLogFlushMs, nil},
		{"part_log", input.EnablePartLog, input.PartLogTTLDays, 7500, nil},
		{"trace_log", input.EnableTraceLog, input.TraceLogTTLDays, 7500, nil},
		{"metric_log", input.EnableMetricLog, input.MetricLogTTLDays, input.MetricLogFlushMs,
			map[string]any{"collect_interval_milliseconds": input.MetricLogCollectMs}},
		{"text_log", input.EnableTextLog, input.TextLogTTLDays, 7500,
			map[string]any{"level": input.TextLogLevel}},
		{"session_log", input.EnableSessionLog, input.SessionLogTTLDays, 7500, nil},
		{"asynchronous_metric_log", input.EnableAsyncMetricLog, input.AsyncMetricLogTTLDays, 7500, nil},
		{"opentelemetry_span_log", input.EnableOtelSpanLog, input.OtelSpanLogTTLDays, 7500, nil},
		{"processors_profile_log", input.EnableProfileLog, 0, 7500, nil},
		{"blob_storage_log", input.EnableBlobLog, 0, 7500, nil},
	}

	for _, l := range logs {
		if !l.enabled {
			cfg[l.key] = map[string]string{"@remove": "1"}
			continue
		}
		ttl := l.ttl
		if ttl == 0 {
			ttl = defaultTTL
		}
		entry := map[string]any{
			"database":                    "system",
			"flush_interval_milliseconds": l.flush,
			"partition_by":                "event_date",
			"ttl":                         fmt.Sprintf("event_date + INTERVAL %d DAY DELETE", ttl),
		}
		for k, v := range l.extra {
			entry[k] = v
		}
		for k, v := range systemLogQueueCaps(c) {
			entry[k] = v
		}
		cfg[l.key] = entry
	}

	// Logs left at the image defaults still get the queue caps (merged by key).
	if caps := systemLogQueueCaps(c); len(caps) > 0 {
		for _, key := range []string{"error_log", "backup_log"} {
			cfg[key] = caps
		}
	}
	// Per-query and per-insert detail logs nothing in LangWatch reads.
	if c.RemoveQueryDetailLogs {
		for _, key := range []string{"query_metric_log", "query_thread_log", "query_views_log", "asynchronous_insert_log"} {
			cfg[key] = map[string]string{"@remove": "1"}
		}
	}

	return writeYAML(filepath.Join(configD, "limits.yaml"), cfg)
}

// systemLogQueueCaps returns the non-zero in-memory queue keys for a system
// log table; empty when the image defaults stand.
func systemLogQueueCaps(c *config.Computed) map[string]any {
	caps := map[string]any{}
	for key, v := range map[string]int{
		"max_size_rows":                    c.SystemLogMaxSizeRows,
		"reserved_size_rows":               c.SystemLogReservedSizeRows,
		"buffer_size_rows_flush_threshold": c.SystemLogFlushThresholdRows,
	} {
		if v != 0 {
			caps[key] = v
		}
	}
	return caps
}
