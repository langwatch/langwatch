package config

import "testing"

func TestComputeFromResources_Memory(t *testing.T) {
	tests := []struct {
		name     string
		cpu      int
		ram      int64
		field    string
		wantFunc func(*Computed) int64
	}{
		{"4GB: server memory = 85%", 2, 4 * gb1, "MaxServerMemoryUsage",
			func(c *Computed) int64 { return c.MaxServerMemoryUsage }},
		{"16GB: server memory = 85%", 4, 16 * gb1, "MaxServerMemoryUsage",
			func(c *Computed) int64 { return c.MaxServerMemoryUsage }},

		{"4GB: query memory = 25%", 2, 4 * gb1, "MaxMemoryUsagePerQuery",
			func(c *Computed) int64 { return c.MaxMemoryUsagePerQuery }},
		{"16GB: query memory = 25%", 4, 16 * gb1, "MaxMemoryUsagePerQuery",
			func(c *Computed) int64 { return c.MaxMemoryUsagePerQuery }},
		{"32GB: query memory capped at 8GB", 8, 32 * gb1, "MaxMemoryUsagePerQuery",
			func(c *Computed) int64 { return c.MaxMemoryUsagePerQuery }},
		{"64GB: query memory capped at 8GB", 16, 64 * gb1, "MaxMemoryUsagePerQuery",
			func(c *Computed) int64 { return c.MaxMemoryUsagePerQuery }},

		{"4GB: external group by = 50% of query", 2, 4 * gb1, "MaxBytesBeforeExternalGroupBy",
			func(c *Computed) int64 { return c.MaxBytesBeforeExternalGroupBy }},

		{"4GB: uncompressed cache = 0 (< 8GB)", 2, 4 * gb1, "UncompressedCacheSize",
			func(c *Computed) int64 { return c.UncompressedCacheSize }},
		{"8GB: uncompressed cache = 12.5%", 2, 8 * gb1, "UncompressedCacheSize",
			func(c *Computed) int64 { return c.UncompressedCacheSize }},
		{"16GB: uncompressed cache = 12.5%", 4, 16 * gb1, "UncompressedCacheSize",
			func(c *Computed) int64 { return c.UncompressedCacheSize }},

		{"4GB: S3 cache = 25%", 2, 4 * gb1, "CacheMaxSize",
			func(c *Computed) int64 { return c.CacheMaxSize }},
	}

	expected := map[string]int64{
		"4GB: server memory = 85%":              4 * gb1 * 85 / 100,
		"16GB: server memory = 85%":             16 * gb1 * 85 / 100,
		"4GB: query memory = 25%":               gb1,      // 4GB * 25% = 1GB
		"16GB: query memory = 25%":              16 * gb1 / 4, // 4GB (under cap)
		"32GB: query memory capped at 8GB":      gb8,          // capped
		"64GB: query memory capped at 8GB":      gb8,          // capped
		"4GB: external group by = 50% of query": gb1 / 2,  // 512MB
		"4GB: uncompressed cache = 0 (< 8GB)":   0,
		"8GB: uncompressed cache = 12.5%":        8 * gb1 / 8,
		"16GB: uncompressed cache = 12.5%":       16 * gb1 / 8,
		"4GB: S3 cache = 25%":                   gb1, // 4GB * 25% = 1GB
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := ComputeFromResources(tt.cpu, tt.ram, nil)
			got := tt.wantFunc(c)
			want := expected[tt.name]
			if got != want {
				t.Errorf("%s = %d, want %d", tt.field, got, want)
			}
		})
	}
}

func TestComputeFromResources_CPU(t *testing.T) {
	tests := []struct {
		name  string
		cpu   int
		field string
		get   func(*Computed) int
		want  int
	}{
		{"1 CPU: bg pool = 2 (min)", 1, "BackgroundPoolSize",
			func(c *Computed) int { return c.BackgroundPoolSize }, 2},
		{"2 CPU: bg pool = 2 (min)", 2, "BackgroundPoolSize",
			func(c *Computed) int { return c.BackgroundPoolSize }, 2},
		{"4 CPU: bg pool = 2", 4, "BackgroundPoolSize",
			func(c *Computed) int { return c.BackgroundPoolSize }, 2},
		{"8 CPU: bg pool = 4", 8, "BackgroundPoolSize",
			func(c *Computed) int { return c.BackgroundPoolSize }, 4},
		{"16 CPU: bg pool = 8", 16, "BackgroundPoolSize",
			func(c *Computed) int { return c.BackgroundPoolSize }, 8},

		{"2 CPU: max concurrent = 50", 2, "MaxConcurrentQueries",
			func(c *Computed) int { return c.MaxConcurrentQueries }, 50},
		{"4 CPU: max concurrent = 100", 4, "MaxConcurrentQueries",
			func(c *Computed) int { return c.MaxConcurrentQueries }, 100},
		{"8 CPU: max concurrent = 200 (cap)", 8, "MaxConcurrentQueries",
			func(c *Computed) int { return c.MaxConcurrentQueries }, 200},
		{"16 CPU: max concurrent = 200 (cap)", 16, "MaxConcurrentQueries",
			func(c *Computed) int { return c.MaxConcurrentQueries }, 200},

		{"1 CPU: insert threads = 1 (min)", 1, "MaxInsertThreads",
			func(c *Computed) int { return c.MaxInsertThreads }, 1},
		{"4 CPU: insert threads = 2", 4, "MaxInsertThreads",
			func(c *Computed) int { return c.MaxInsertThreads }, 2},
		{"8 CPU: insert threads = 4", 8, "MaxInsertThreads",
			func(c *Computed) int { return c.MaxInsertThreads }, 4},

		{"4 CPU: download threads = 4", 4, "MaxDownloadThreads",
			func(c *Computed) int { return c.MaxDownloadThreads }, 4},
		{"16 CPU: download threads = 8 (cap)", 16, "MaxDownloadThreads",
			func(c *Computed) int { return c.MaxDownloadThreads }, 8},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := ComputeFromResources(tt.cpu, 4*gb1, nil)
			got := tt.get(c)
			if got != tt.want {
				t.Errorf("%s = %d, want %d", tt.field, got, tt.want)
			}
		})
	}
}

func TestComputeFromResources_MergeTree(t *testing.T) {
	tests := []struct {
		name string
		cpu  int
		ram  int64
		get  func(*Computed) int
		want int
	}{
		{"2 CPU: max parts merge = 5", 2, 4 * gb1,
			func(c *Computed) int { return c.MaxPartsToMergeAtOnce }, 5},
		{"4 CPU: max parts merge = 8", 4, 16 * gb1,
			func(c *Computed) int { return c.MaxPartsToMergeAtOnce }, 8},
		{"8 CPU: max parts merge = 15", 8, 32 * gb1,
			func(c *Computed) int { return c.MaxPartsToMergeAtOnce }, 15},
		{"5 CPU: max parts merge = 15", 5, 16 * gb1,
			func(c *Computed) int { return c.MaxPartsToMergeAtOnce }, 15},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := ComputeFromResources(tt.cpu, tt.ram, nil)
			got := tt.get(c)
			if got != tt.want {
				t.Errorf("got %d, want %d", got, tt.want)
			}
		})
	}

	t.Run("max bytes to merge scales with RAM", func(t *testing.T) {
		c := ComputeFromResources(4, 16*gb1, nil)
		want := 16 * gb1 * 3 / 100
		if c.MaxBytesToMergeAtMaxSpace != want {
			t.Errorf("MaxBytesToMergeAtMaxSpace = %d, want %d", c.MaxBytesToMergeAtMaxSpace, want)
		}
		if c.MaxBytesToMergeAtMinSpace != want/2 {
			t.Errorf("MaxBytesToMergeAtMinSpace = %d, want %d", c.MaxBytesToMergeAtMinSpace, want/2)
		}
	})

	t.Run("pool free entries are fractions of bg pool size", func(t *testing.T) {
		c := ComputeFromResources(8, 16*gb1, nil)
		// 8 CPU → BackgroundPoolSize=4, so mutation=2, lowerMerge=1, optimize=2
		if c.PoolFreeEntryMutation != c.BackgroundPoolSize/2 {
			t.Errorf("PoolFreeEntryMutation = %d, want %d", c.PoolFreeEntryMutation, c.BackgroundPoolSize/2)
		}
		if c.PoolFreeEntryLowerMerge != max(1, c.BackgroundPoolSize/4) {
			t.Errorf("PoolFreeEntryLowerMerge = %d, want %d", c.PoolFreeEntryLowerMerge, max(1, c.BackgroundPoolSize/4))
		}
		if c.PoolFreeEntryOptimizePartition != c.BackgroundPoolSize/2 {
			t.Errorf("PoolFreeEntryOptimizePartition = %d, want %d", c.PoolFreeEntryOptimizePartition, c.BackgroundPoolSize/2)
		}
	})
}

func TestComputeFromResources_Constants(t *testing.T) {
	c := ComputeFromResources(4, 16*gb1, nil)

	if c.AsyncInsertEnabled != 1 {
		t.Errorf("AsyncInsertEnabled = %d, want 1", c.AsyncInsertEnabled)
	}
	if c.AsyncInsertWait != 1 {
		t.Errorf("AsyncInsertWait = %d, want 1", c.AsyncInsertWait)
	}
	if c.VerticalMergeMinRows != 1 {
		t.Errorf("VerticalMergeMinRows = %d, want 1", c.VerticalMergeMinRows)
	}
	if c.OptimizeOnInsert != 0 {
		t.Errorf("OptimizeOnInsert = %d, want 0", c.OptimizeOnInsert)
	}
}

func TestComputeFromResources_QueryLimitsPassthrough(t *testing.T) {
	input := &Input{
		MaxExecutionTime:    300,
		MaxRowsToRead:       1000000,
		GroupByOverflowMode: "any",
		MaxConnections:      8192,
		KeepAliveTimeout:    30,
		HTTPReceiveTimeout:  3600,
		HTTPSendTimeout:     3600,
		TCPKeepAliveTimeout: 30,
		ListenBacklog:       8192,
	}

	c := ComputeFromResources(4, 16*gb1, input)

	if c.MaxExecutionTime != 300 {
		t.Errorf("MaxExecutionTime = %d, want 300", c.MaxExecutionTime)
	}
	if c.MaxRowsToRead != 1000000 {
		t.Errorf("MaxRowsToRead = %d, want 1000000", c.MaxRowsToRead)
	}
	if c.GroupByOverflowMode != "any" {
		t.Errorf("GroupByOverflowMode = %q, want %q", c.GroupByOverflowMode, "any")
	}
	if c.MaxConnections != 8192 {
		t.Errorf("MaxConnections = %d, want 8192", c.MaxConnections)
	}
}
