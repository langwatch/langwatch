package cell

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Sample is one reading of one process group or store, a line of resources.jsonl.
type Sample struct {
	AtMs  int64   `json:"atMs"`
	Name  string  `json:"name"`
	RSSKB int64   `json:"rssKb,omitempty"`
	CPU   float64 `json:"cpuPct,omitempty"`
	Bytes int64   `json:"bytes,omitempty"` // ClickHouse MemoryTracking, Redis used_memory
}

// ResourcePeak is the highest each name reached over the cell.
type ResourcePeak struct {
	Name  string  `json:"name"`
	RSSKB int64   `json:"peakRssKb,omitempty"`
	CPU   float64 `json:"peakCpuPct,omitempty"`
	Bytes int64   `json:"peakBytes,omitempty"`
}

// SampleSpec is what the sampler reads: the cell's processes (read each tick, they change) and its stores.
type SampleSpec struct {
	Path           string
	Origin         time.Time
	Every          time.Duration
	Procs          func() []*Proc
	ClickHouseBase string
	RedisPort      string
}

// SampleResources writes a Sample per process group and store every spec.Every until ctx ends.
func SampleResources(ctx context.Context, spec SampleSpec) {
	file, err := os.OpenFile(filepath.Clean(spec.Path), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return
	}
	defer func() { _ = file.Close() }()
	write := bufio.NewWriter(file)
	ticker := time.NewTicker(spec.Every)
	defer ticker.Stop()
	for {
		at := time.Since(spec.Origin).Milliseconds()
		for _, sample := range spec.read(ctx, at) {
			line, _ := json.Marshal(sample)
			_, _ = write.Write(append(line, '\n'))
		}
		_ = write.Flush()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (spec SampleSpec) read(ctx context.Context, at int64) []Sample {
	var samples []Sample
	groups := map[int]string{}
	for _, proc := range spec.Procs() {
		if proc != nil && proc.command != nil && proc.command.Process != nil {
			groups[proc.command.Process.Pid] = proc.Name // Start gives each proc its own group, pgid = pid.
		}
	}
	if out, err := exec.CommandContext(ctx, "ps", "-axo", "pgid=,rss=,pcpu=").Output(); err == nil { // #nosec G204 -- fixed argv.
		samples = append(samples, sumGroups(string(out), groups, at)...)
	}
	if out, err := clickhouseQuery(ctx, spec.ClickHouseBase+"/", "SELECT value FROM system.metrics WHERE metric = 'MemoryTracking'"); err == nil {
		if bytes, err := strconv.ParseInt(strings.TrimSpace(out), 10, 64); err == nil {
			samples = append(samples, Sample{AtMs: at, Name: "clickhouse", Bytes: bytes})
		}
	}
	if out, err := exec.CommandContext(ctx, "redis-cli", "-p", spec.RedisPort, "INFO", "memory").Output(); err == nil { // #nosec G204 -- fixed argv.
		if bytes, ok := redisUsedMemory(string(out)); ok {
			samples = append(samples, Sample{AtMs: at, Name: "redis", Bytes: bytes})
		}
	}
	return samples
}

// sumGroups adds up `ps -o pgid,rss,pcpu` lines per wanted process group.
func sumGroups(psOutput string, groups map[int]string, at int64) []Sample {
	totals := map[string]*Sample{}
	for _, line := range strings.Split(psOutput, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 3 {
			continue
		}
		pgid, _ := strconv.Atoi(fields[0])
		name, ok := groups[pgid]
		if !ok {
			continue
		}
		rss, _ := strconv.ParseInt(fields[1], 10, 64)
		cpu, _ := strconv.ParseFloat(fields[2], 64)
		if totals[name] == nil {
			totals[name] = &Sample{AtMs: at, Name: name}
		}
		totals[name].RSSKB += rss
		totals[name].CPU += cpu
	}
	var samples []Sample
	for _, name := range slices.Sorted(maps.Keys(totals)) {
		samples = append(samples, *totals[name])
	}
	return samples
}

func redisUsedMemory(info string) (int64, bool) {
	for _, line := range strings.Split(info, "\n") {
		if value, found := strings.CutPrefix(strings.TrimSpace(line), "used_memory:"); found {
			bytes, err := strconv.ParseInt(value, 10, 64)
			return bytes, err == nil
		}
	}
	return 0, false
}

// ResourcePeaks reads resources.jsonl and answers each name's peaks, sorted by name.
func ResourcePeaks(path string) ([]ResourcePeak, error) {
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return nil, err
	}
	peaks := map[string]*ResourcePeak{}
	for _, line := range strings.Split(string(data), "\n") {
		var sample Sample
		if json.Unmarshal([]byte(line), &sample) != nil || sample.Name == "" {
			continue
		}
		peak := peaks[sample.Name]
		if peak == nil {
			peak = &ResourcePeak{Name: sample.Name}
			peaks[sample.Name] = peak
		}
		peak.RSSKB, peak.CPU, peak.Bytes = max(peak.RSSKB, sample.RSSKB), max(peak.CPU, sample.CPU), max(peak.Bytes, sample.Bytes)
	}
	var out []ResourcePeak
	for _, name := range slices.Sorted(maps.Keys(peaks)) {
		out = append(out, *peaks[name])
	}
	return out, nil
}

func (peak ResourcePeak) String() string {
	return fmt.Sprintf("| %s | %d | %.0f | %d |", peak.Name, peak.RSSKB/1024, peak.CPU, peak.Bytes/(1<<20))
}
