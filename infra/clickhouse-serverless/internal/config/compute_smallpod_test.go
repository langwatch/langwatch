package config

import "testing"

const mb1 int64 = 1 << 20

func TestComputeFromResources_SmallPodBudget(t *testing.T) {
	tests := []struct {
		name                string
		cpu                 int
		ram                 int64
		wantMarkCache       int64
		wantSmallCaches     int64 // index mark, primary index, query condition, compiled expression
		wantConcurrencyRate int
	}{
		{"1 GiB", 1, gb1, 64 * mb1, 16 * mb1, 1},
		{"2 GiB", 1, 2 * gb1, 128 * mb1, 32 * mb1, 1},
		{"4 GiB", 2, 4 * gb1, 256 * mb1, 64 * mb1, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := ComputeFromResources(tt.cpu, tt.ram, nil)
			if c.MarkCacheSize != tt.wantMarkCache {
				t.Errorf("MarkCacheSize = %d, want %d", c.MarkCacheSize, tt.wantMarkCache)
			}
			for name, got := range map[string]int64{
				"IndexMarkCacheSize":          c.IndexMarkCacheSize,
				"PrimaryIndexCacheSize":       c.PrimaryIndexCacheSize,
				"QueryConditionCacheSize":     c.QueryConditionCacheSize,
				"CompiledExpressionCacheSize": c.CompiledExpressionCacheSize,
			} {
				if got != tt.wantSmallCaches {
					t.Errorf("%s = %d, want %d", name, got, tt.wantSmallCaches)
				}
			}
			if c.ConcurrencyRatio != tt.wantConcurrencyRate {
				t.Errorf("ConcurrencyRatio = %d, want %d", c.ConcurrencyRatio, tt.wantConcurrencyRate)
			}
			if c.UncompressedCacheSize != 0 || c.UseUncompressedCache != 0 {
				t.Errorf("uncompressed cache must stay off, got size %d use %d", c.UncompressedCacheSize, c.UseUncompressedCache)
			}
			if c.MmapCacheSize != 128 || c.MergesMemoryRatio != 0.25 {
				t.Errorf("MmapCacheSize = %d, MergesMemoryRatio = %v, want 128 and 0.25", c.MmapCacheSize, c.MergesMemoryRatio)
			}
			if c.BackgroundSchedulePoolSize != 16 || c.BackgroundCommonPoolSize != 4 || c.BackgroundMovePoolSize != 2 {
				t.Errorf("pools = %d/%d/%d, want 16/4/2",
					c.BackgroundSchedulePoolSize, c.BackgroundCommonPoolSize, c.BackgroundMovePoolSize)
			}
			if c.BackgroundBrokerPoolSize != 1 || c.BackgroundDistPoolSize != 1 || c.BackgroundBufferPoolSize != 1 ||
				c.BackgroundFetchesPoolSize != 1 || c.MaxThreadPoolFreeSize != 8 {
				t.Errorf("idle pools = %d/%d/%d/%d free %d, want 1/1/1/1 free 8", c.BackgroundBrokerPoolSize,
					c.BackgroundDistPoolSize, c.BackgroundBufferPoolSize, c.BackgroundFetchesPoolSize, c.MaxThreadPoolFreeSize)
			}
			if c.SystemLogMaxSizeRows != 16384 || c.SystemLogReservedSizeRows != 1024 || c.SystemLogFlushThresholdRows != 8192 {
				t.Errorf("system log caps = %d/%d/%d, want 16384/1024/8192",
					c.SystemLogMaxSizeRows, c.SystemLogReservedSizeRows, c.SystemLogFlushThresholdRows)
			}
			if !c.RemoveQueryDetailLogs {
				t.Error("RemoveQueryDetailLogs = false, want true")
			}
			if c.MaxServerMemoryUsage != tt.ram*85/100 {
				t.Errorf("MaxServerMemoryUsage = %d, want 85%% of RAM", c.MaxServerMemoryUsage)
			}
		})
	}
}

func TestComputeFromResources_LargePodKeepsDefaults(t *testing.T) {
	for _, ram := range []int64{8 * gb1, 16 * gb1} {
		c := ComputeFromResources(4, ram, nil)
		if c.MarkCacheSize != 0 || c.IndexMarkCacheSize != 0 || c.PrimaryIndexCacheSize != 0 ||
			c.QueryConditionCacheSize != 0 || c.CompiledExpressionCacheSize != 0 || c.MmapCacheSize != 0 ||
			c.MergesMemoryRatio != 0 || c.BackgroundSchedulePoolSize != 0 || c.BackgroundCommonPoolSize != 0 ||
			c.BackgroundMovePoolSize != 0 || c.BackgroundBrokerPoolSize != 0 || c.MaxThreadPoolFreeSize != 0 ||
			c.SystemLogMaxSizeRows != 0 || c.RemoveQueryDetailLogs {
			t.Errorf("%d GiB: small-pod settings must stay unset, got %+v", ram/gb1, c)
		}
		if c.ConcurrencyRatio != 2 {
			t.Errorf("%d GiB: ConcurrencyRatio = %d, want 2", ram/gb1, c.ConcurrencyRatio)
		}
	}
}
