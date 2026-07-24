package render

import (
	"path/filepath"

	"github.com/langwatch/langwatch/clickhouse-serverless/internal/config"
)

// renderProfiles writes profiles.yaml with the default user profile settings.
func renderProfiles(c *config.Computed, usersD string) error {
	profile := map[string]any{
		"max_memory_usage":                   c.MaxMemoryUsagePerQuery,
		"max_bytes_before_external_group_by": c.MaxBytesBeforeExternalGroupBy,
		"max_bytes_before_external_sort":     c.MaxBytesBeforeExternalSort,
		"async_insert":                       c.AsyncInsertEnabled,
		"wait_for_async_insert":              c.AsyncInsertWait,
		"async_insert_max_data_size":         c.AsyncInsertMaxDataSize,
		"async_insert_busy_timeout_ms":       c.AsyncInsertBusyTimeoutMs,
		"use_uncompressed_cache":             c.UseUncompressedCache,
		"max_download_threads":               c.MaxDownloadThreads,
		"max_download_buffer_size":           c.MaxDownloadBufferSize,
		"optimize_on_insert":                 c.OptimizeOnInsert,
		"max_insert_threads":                 c.MaxInsertThreads,
		"http_receive_timeout":               c.HTTPReceiveTimeout,
		"http_send_timeout":                  c.HTTPSendTimeout,
		"tcp_keep_alive_timeout":             c.TCPKeepAliveTimeout,
	}

	// Query limits — only include non-zero values.
	if c.MaxExecutionTime != 0 {
		profile["max_execution_time"] = c.MaxExecutionTime
	}
	if c.MaxRowsToRead != 0 {
		profile["max_rows_to_read"] = c.MaxRowsToRead
	}
	if c.MaxBytesToRead != 0 {
		profile["max_bytes_to_read"] = c.MaxBytesToRead
	}
	if c.MaxResultRows != 0 {
		profile["max_result_rows"] = c.MaxResultRows
	}
	if c.MaxResultBytes != 0 {
		profile["max_result_bytes"] = c.MaxResultBytes
	}
	if c.MaxRowsToGroupBy != 0 {
		profile["max_rows_to_group_by"] = c.MaxRowsToGroupBy
		profile["group_by_overflow_mode"] = c.GroupByOverflowMode
	}
	return writeYAML(filepath.Join(usersD, "profiles.yaml"), map[string]any{
		"profiles": map[string]any{"default": profile},
	})
}
