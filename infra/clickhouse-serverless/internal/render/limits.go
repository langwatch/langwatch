package render

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/clickhouse-serverless/internal/config"
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
		},
		"max_server_memory_usage":                       c.MaxServerMemoryUsage,
		"max_server_memory_usage_to_ram_ratio":          c.MaxServerMemoryRatio,
		"max_concurrent_queries":                        c.MaxConcurrentQueries,
		"uncompressed_cache_size":                       c.UncompressedCacheSize,
		"background_pool_size":                          c.BackgroundPoolSize,
		"background_merges_mutations_concurrency_ratio": c.ConcurrencyRatio,
	}

	if c.MaxTempDataOnDisk != 0 {
		cfg["max_temporary_data_on_disk_size"] = c.MaxTempDataOnDisk
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
		cfg[l.key] = entry
	}

	return writeYAML(filepath.Join(configD, "limits.yaml"), cfg)
}
