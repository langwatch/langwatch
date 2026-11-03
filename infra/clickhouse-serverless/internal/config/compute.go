package config

const (
	gb1  int64 = 1 << 30
	gb4  int64 = 4 << 30
	gb8  int64 = 8 << 30
	mb10 int64 = 10 << 20
	mb50 int64 = 50 << 20

	// smallPodRAM is the largest pod that gets the explicit small-pod budget.
	smallPodRAM int64 = 4 << 30
)

// Computed holds all derived ClickHouse configuration parameters.
// The `env` tags allow individual overrides via env vars (applied by applyEnvOverrides).
type Computed struct {
	// Memory (derived from RAM)
	MaxServerMemoryUsage          int64   `env:"MAX_SERVER_MEMORY_USAGE"`
	MaxServerMemoryRatio          float64 `env:"MAX_SERVER_MEMORY_USAGE_TO_RAM_RATIO"`
	MaxMemoryUsagePerQuery        int64   `env:"MAX_MEMORY_USAGE_PER_QUERY"`
	MaxBytesBeforeExternalGroupBy int64   `env:"MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY"`
	MaxBytesBeforeExternalSort    int64   `env:"MAX_BYTES_BEFORE_EXTERNAL_SORT"`
	UncompressedCacheSize         int64   `env:"UNCOMPRESSED_CACHE_SIZE"`
	UseUncompressedCache          int     `env:"USE_UNCOMPRESSED_CACHE"`
	CacheMaxSize                  int64   `env:"CACHE_MAX_SIZE"`

	// Small-pod budget: server settings in config.d. Zero (or false) leaves
	// the ClickHouse default, so pods above smallPodRAM render none of these.
	MarkCacheSize               int64   `env:"MARK_CACHE_SIZE"`
	IndexMarkCacheSize          int64   `env:"INDEX_MARK_CACHE_SIZE"`
	PrimaryIndexCacheSize       int64   `env:"PRIMARY_INDEX_CACHE_SIZE"`
	QueryConditionCacheSize     int64   `env:"QUERY_CONDITION_CACHE_SIZE"`
	CompiledExpressionCacheSize int64   `env:"COMPILED_EXPRESSION_CACHE_SIZE"`
	MmapCacheSize               int     `env:"MMAP_CACHE_SIZE"`
	MergesMemoryRatio           float64 `env:"MERGES_MUTATIONS_MEMORY_USAGE_TO_RAM_RATIO"`
	BackgroundSchedulePoolSize  int     `env:"BACKGROUND_SCHEDULE_POOL_SIZE"`
	BackgroundCommonPoolSize    int     `env:"BACKGROUND_COMMON_POOL_SIZE"`
	BackgroundMovePoolSize      int     `env:"BACKGROUND_MOVE_POOL_SIZE"`
	BackgroundBrokerPoolSize    int     `env:"BACKGROUND_MESSAGE_BROKER_SCHEDULE_POOL_SIZE"`
	BackgroundDistPoolSize      int     `env:"BACKGROUND_DISTRIBUTED_SCHEDULE_POOL_SIZE"`
	BackgroundBufferPoolSize    int     `env:"BACKGROUND_BUFFER_FLUSH_SCHEDULE_POOL_SIZE"`
	BackgroundFetchesPoolSize   int     `env:"BACKGROUND_FETCHES_POOL_SIZE"`
	MaxThreadPoolFreeSize       int     `env:"MAX_THREAD_POOL_FREE_SIZE"`

	// System log queues: a failed flush keeps rows in memory up to max_size_rows.
	SystemLogMaxSizeRows        int  `env:"SYSTEM_LOG_MAX_SIZE_ROWS"`
	SystemLogReservedSizeRows   int  `env:"SYSTEM_LOG_RESERVED_SIZE_ROWS"`
	SystemLogFlushThresholdRows int  `env:"SYSTEM_LOG_BUFFER_SIZE_ROWS_FLUSH_THRESHOLD"`
	RemoveQueryDetailLogs       bool `env:"REMOVE_QUERY_DETAIL_LOGS"`

	// CPU (derived from CPU cores)
	BackgroundPoolSize    int `env:"BACKGROUND_POOL_SIZE"`
	ConcurrencyRatio      int `env:"BACKGROUND_MERGES_MUTATIONS_CONCURRENCY_RATIO"`
	MaxConcurrentQueries  int `env:"MAX_CONCURRENT_QUERIES"`
	MaxInsertThreads      int `env:"MAX_INSERT_THREADS"`
	MaxDownloadThreads    int `env:"MAX_DOWNLOAD_THREADS"`
	MaxDownloadBufferSize int `env:"MAX_DOWNLOAD_BUFFER_SIZE"`

	// MergeTree (derived from CPU + RAM)
	MinBytesForWidePart            int64 `env:"MIN_BYTES_FOR_WIDE_PART"`
	MinRowsForWidePart             int   `env:"MIN_ROWS_FOR_WIDE_PART"`
	PartsToDelayInsert             int   `env:"PARTS_TO_DELAY_INSERT"`
	PartsToThrowInsert             int   `env:"PARTS_TO_THROW_INSERT"`
	MaxBytesToMergeAtMaxSpace      int64 `env:"MAX_BYTES_TO_MERGE_AT_MAX_SPACE_IN_POOL"`
	MaxBytesToMergeAtMinSpace      int64 `env:"MAX_BYTES_TO_MERGE_AT_MIN_SPACE"`
	MaxPartsToMergeAtOnce          int   `env:"MAX_PARTS_TO_MERGE_AT_ONCE"`
	VerticalMergeMinRows           int   `env:"VERTICAL_MERGE_ALGORITHM_MIN_ROWS_TO_ACTIVATE"`
	VerticalMergeMinColumns        int   `env:"VERTICAL_MERGE_ALGORITHM_MIN_COLUMNS_TO_ACTIVATE"`
	MergeWithTTLTimeout            int   `env:"MERGE_WITH_TTL_TIMEOUT"`
	MergeSelectingSleepMs          int   `env:"MERGE_SELECTING_SLEEP_MS"`
	PoolFreeEntryMutation          int   `env:"NUMBER_OF_FREE_ENTRIES_IN_POOL_TO_EXECUTE_MUTATION"`
	PoolFreeEntryLowerMerge        int   `env:"NUMBER_OF_FREE_ENTRIES_IN_POOL_TO_LOWER_MAX_SIZE_OF_MERGE"`
	PoolFreeEntryOptimizePartition int   `env:"NUMBER_OF_FREE_ENTRIES_IN_POOL_TO_EXECUTE_OPTIMIZE_ENTIRE_PARTITION"`

	// Async Insert
	AsyncInsertEnabled       int `env:"ASYNC_INSERT_ENABLED"`
	AsyncInsertWait          int `env:"ASYNC_INSERT_WAIT"`
	AsyncInsertMaxDataSize   int `env:"ASYNC_INSERT_MAX_DATA_SIZE"`
	AsyncInsertBusyTimeoutMs int `env:"ASYNC_INSERT_BUSY_TIMEOUT_MS"`

	// Insert performance
	OptimizeOnInsert int `env:"OPTIMIZE_ON_INSERT"`

	// Query limits
	MaxExecutionTime    int    `env:"MAX_EXECUTION_TIME"`
	MaxRowsToRead       int64  `env:"MAX_ROWS_TO_READ"`
	MaxBytesToRead      int64  `env:"MAX_BYTES_TO_READ"`
	MaxResultRows       int64  `env:"MAX_RESULT_ROWS"`
	MaxResultBytes      int64  `env:"MAX_RESULT_BYTES"`
	MaxRowsToGroupBy    int64  `env:"MAX_ROWS_TO_GROUP_BY"`
	GroupByOverflowMode string `env:"GROUP_BY_OVERFLOW_MODE"`
	MaxTempDataOnDisk   int64  `env:"MAX_TEMPORARY_DATA_ON_DISK_SIZE"`

	// Network
	MaxConnections      int `env:"MAX_CONNECTIONS"`
	KeepAliveTimeout    int `env:"KEEP_ALIVE_TIMEOUT"`
	HTTPReceiveTimeout  int `env:"HTTP_RECEIVE_TIMEOUT"`
	HTTPSendTimeout     int `env:"HTTP_SEND_TIMEOUT"`
	TCPKeepAliveTimeout int `env:"TCP_KEEP_ALIVE_TIMEOUT"`
	ListenBacklog       int `env:"LISTEN_BACKLOG"`
}

// ComputeFromResources derives all ClickHouse parameters from CPU cores and RAM bytes.
func ComputeFromResources(cpu int, ramBytes int64, input *Input) *Computed {
	c := &Computed{}

	// --- Memory allocation ---
	c.MaxServerMemoryUsage = ramBytes * 85 / 100
	c.MaxServerMemoryRatio = 0.85

	queryMemory := ramBytes / 4 // 25% of RAM
	if queryMemory > gb8 {
		queryMemory = gb8
	}
	c.MaxMemoryUsagePerQuery = queryMemory
	c.MaxBytesBeforeExternalGroupBy = queryMemory / 2
	c.MaxBytesBeforeExternalSort = queryMemory / 2

	if ramBytes >= gb8 {
		c.UncompressedCacheSize = ramBytes / 8 // 12.5%
		c.UseUncompressedCache = 1
	}

	c.CacheMaxSize = ramBytes / 4 // 25% for S3 cache

	if ramBytes <= smallPodRAM {
		applySmallPodBudget(c, ramBytes, input != nil && input.Replicated)
	}

	// --- CPU allocation ---
	c.BackgroundPoolSize = max(2, cpu/2)
	c.ConcurrencyRatio = 2
	c.MaxConcurrentQueries = min(cpu*25, 200)
	c.MaxInsertThreads = max(1, cpu/2)
	c.MaxDownloadThreads = min(cpu, 8)
	c.MaxDownloadBufferSize = int(mb50)

	// --- MergeTree ---
	c.MinBytesForWidePart = mb10
	c.MinRowsForWidePart = 10000
	c.PartsToDelayInsert = 150
	c.PartsToThrowInsert = 250

	c.MaxBytesToMergeAtMaxSpace = ramBytes * 3 / 100
	c.MaxBytesToMergeAtMinSpace = c.MaxBytesToMergeAtMaxSpace / 2

	switch {
	case cpu <= 2:
		c.MaxPartsToMergeAtOnce = 5
	case cpu <= 4:
		c.MaxPartsToMergeAtOnce = 8
	default:
		c.MaxPartsToMergeAtOnce = 15
	}

	c.VerticalMergeMinRows = 1
	c.VerticalMergeMinColumns = 1
	c.MergeWithTTLTimeout = 86400
	c.MergeSelectingSleepMs = 1000

	c.PoolFreeEntryMutation = max(1, c.BackgroundPoolSize/2)
	c.PoolFreeEntryLowerMerge = max(1, c.BackgroundPoolSize/4)
	c.PoolFreeEntryOptimizePartition = max(1, c.BackgroundPoolSize/2)

	if ramBytes <= smallPodRAM {
		c.ConcurrencyRatio = 1 // at most background_pool_size merges at once
	}

	// --- Async Insert (constants) ---
	c.AsyncInsertEnabled = 1
	c.AsyncInsertWait = 1
	c.AsyncInsertMaxDataSize = int(mb10)
	c.AsyncInsertBusyTimeoutMs = 1000

	// --- Insert performance ---
	c.OptimizeOnInsert = 0

	// --- Query limits (from input, passthrough) ---
	if input != nil {
		c.MaxExecutionTime = input.MaxExecutionTime
		c.MaxRowsToRead = input.MaxRowsToRead
		c.MaxBytesToRead = input.MaxBytesToRead
		c.MaxResultRows = input.MaxResultRows
		c.MaxResultBytes = input.MaxResultBytes
		c.MaxRowsToGroupBy = input.MaxRowsToGroupBy
		c.GroupByOverflowMode = input.GroupByOverflowMode
		c.MaxTempDataOnDisk = input.MaxTempDataOnDisk

		c.MaxConnections = input.MaxConnections
		c.KeepAliveTimeout = input.KeepAliveTimeout
		c.HTTPReceiveTimeout = input.HTTPReceiveTimeout
		c.HTTPSendTimeout = input.HTTPSendTimeout
		c.TCPKeepAliveTimeout = input.TCPKeepAliveTimeout
		c.ListenBacklog = input.ListenBacklog
	}

	return c
}

// applySmallPodBudget bounds the caches ClickHouse otherwise sizes at up to
// half of RAM each (cache_size_to_ram_max_ratio 0.5), trims idle thread pools
// on a single node (replication fetches and schedules on them) and caps system
// log queues. Every name is a 25.10 server setting; log caps are per-table keys.
func applySmallPodBudget(c *Computed, ramBytes int64, replicated bool) {
	c.MarkCacheSize = ramBytes / 16
	c.IndexMarkCacheSize = ramBytes / 64
	c.PrimaryIndexCacheSize = ramBytes / 64
	c.QueryConditionCacheSize = ramBytes / 64
	c.CompiledExpressionCacheSize = ramBytes / 64
	c.MmapCacheSize = 128
	c.MergesMemoryRatio = 0.25

	c.SystemLogMaxSizeRows = 16384
	c.SystemLogReservedSizeRows = 1024
	c.SystemLogFlushThresholdRows = 8192
	c.RemoveQueryDetailLogs = true

	if replicated {
		return
	}
	// Each idle thread keeps its own allocator cache: 338 threads held ~350 MiB untracked at 1 GiB.
	c.BackgroundSchedulePoolSize = 16
	c.BackgroundCommonPoolSize = 4
	c.BackgroundMovePoolSize = 2
	c.BackgroundBrokerPoolSize = 1
	c.BackgroundDistPoolSize = 1
	c.BackgroundBufferPoolSize = 1
	c.BackgroundFetchesPoolSize = 1
	c.MaxThreadPoolFreeSize = 8
}
