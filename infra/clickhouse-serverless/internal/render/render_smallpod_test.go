package render_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/render"
)

var smallPodKeys = []string{
	"mark_cache_size:",
	"index_mark_cache_size:",
	"primary_index_cache_size:",
	"query_condition_cache_size:",
	"compiled_expression_cache_size:",
	"mmap_cache_size:",
	"merges_mutations_memory_usage_to_ram_ratio:",
	"background_schedule_pool_size:",
	"background_common_pool_size:",
	"background_move_pool_size:",
	"max_size_rows:",
	"query_metric_log:",
	"asynchronous_insert_log:",
}

func renderLimitsFor(t *testing.T, cpu int, ram int64) string {
	t.Helper()
	dir := t.TempDir()
	input := testInput()
	input.CPU, input.RAMBytes = cpu, ram
	computed := config.ComputeFromResources(cpu, ram, input)
	if err := render.RenderAll(testLogger(), input, computed, dir); err != nil {
		t.Fatalf("RenderAll: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "config.d/limits.yaml"))
	if err != nil {
		t.Fatalf("read limits.yaml: %v", err)
	}
	return string(data)
}

func TestRenderAll_SmallPodBudget(t *testing.T) {
	limits := renderLimitsFor(t, 1, gb1)
	for _, key := range smallPodKeys {
		if !strings.Contains(limits, key) {
			t.Errorf("1 GiB limits.yaml missing %q", key)
		}
	}
	for _, want := range []string{"mark_cache_size: 67108864", "max_size_rows: 16384"} {
		if !strings.Contains(limits, want) {
			t.Errorf("1 GiB limits.yaml missing %q", want)
		}
	}
}

func TestRenderAll_LargePodKeepsDefaults(t *testing.T) {
	limits := renderLimitsFor(t, 4, 16*gb1)
	for _, key := range smallPodKeys {
		if strings.Contains(limits, key) {
			t.Errorf("16 GiB limits.yaml must not contain %q", key)
		}
	}
}
