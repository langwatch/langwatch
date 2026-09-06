package config

import (
	"testing"
)

func TestParseCPUMaxV2(t *testing.T) {
	tests := []struct {
		name     string
		data     string
		wantCPU  int
		wantOK   bool
	}{
		{"4 cores", "400000 100000\n", 4, true},
		{"1 core", "100000 100000\n", 1, true},
		{"8 cores", "800000 100000\n", 8, true},
		{"unlimited", "max 100000\n", 0, false},
		{"empty", "", 0, false},
		{"fractional (rounds up to 1)", "50000 100000\n", 1, true},
		{"1.5 cores (rounds up to 2)", "150000 100000\n", 2, true},
		{"invalid quota", "abc 100000\n", 0, false},
		{"zero period", "400000 0\n", 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cpu, ok := parseCPUMaxV2(tt.data)
			if ok != tt.wantOK {
				t.Fatalf("parseCPUMaxV2(%q) ok = %v, want %v", tt.data, ok, tt.wantOK)
			}
			if cpu != tt.wantCPU {
				t.Errorf("parseCPUMaxV2(%q) = %d, want %d", tt.data, cpu, tt.wantCPU)
			}
		})
	}
}

func TestParseCPUQuotaV1(t *testing.T) {
	tests := []struct {
		name     string
		quota    string
		period   string
		wantCPU  int
		wantOK   bool
	}{
		{"2 cores", "200000\n", "100000\n", 2, true},
		{"no limit (-1)", "-1\n", "100000\n", 0, false},
		{"invalid quota", "abc\n", "100000\n", 0, false},
		{"zero period", "200000\n", "0\n", 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cpu, ok := parseCPUQuotaV1(tt.quota, tt.period)
			if ok != tt.wantOK {
				t.Fatalf("parseCPUQuotaV1 ok = %v, want %v", ok, tt.wantOK)
			}
			if cpu != tt.wantCPU {
				t.Errorf("parseCPUQuotaV1 = %d, want %d", cpu, tt.wantCPU)
			}
		})
	}
}

func TestParseMemoryMax(t *testing.T) {
	tests := []struct {
		name    string
		data    string
		wantRAM int64
		wantOK  bool
	}{
		{"8GB", "8589934592\n", 8589934592, true},
		{"4GB", "4294967296\n", 4294967296, true},
		{"unlimited (max)", "max\n", 0, false},
		{"no limit sentinel", "9223372036854771712\n", 0, false},
		{"empty", "", 0, false},
		{"invalid", "abc\n", 0, false},
		{"zero", "0\n", 0, false},
		{"negative", "-1\n", 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ram, ok := parseMemoryMax(tt.data)
			if ok != tt.wantOK {
				t.Fatalf("parseMemoryMax(%q) ok = %v, want %v", tt.data, ok, tt.wantOK)
			}
			if ram != tt.wantRAM {
				t.Errorf("parseMemoryMax(%q) = %d, want %d", tt.data, ram, tt.wantRAM)
			}
		})
	}
}

func TestParseMeminfo(t *testing.T) {
	tests := []struct {
		name    string
		data    string
		wantRAM int64
		wantOK  bool
	}{
		{
			"typical meminfo",
			"MemTotal:       16384000 kB\nMemFree:         1234567 kB\n",
			16384000 * 1024,
			true,
		},
		{"empty", "", 0, false},
		{"no MemTotal", "MemFree: 1234 kB\n", 0, false},
		{"malformed", "MemTotal: abc kB\n", 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ram, ok := parseMeminfo(tt.data)
			if ok != tt.wantOK {
				t.Fatalf("parseMeminfo ok = %v, want %v", ok, tt.wantOK)
			}
			if ram != tt.wantRAM {
				t.Errorf("parseMeminfo = %d, want %d", ram, tt.wantRAM)
			}
		})
	}
}

func TestDetectCPU_Fallback(t *testing.T) {
	// On macOS (dev machine), cgroups don't exist, so we fall back to runtime.NumCPU.
	cpu, err := DetectCPU()
	if err != nil {
		t.Fatalf("DetectCPU() error: %v", err)
	}
	if cpu < 1 {
		t.Errorf("DetectCPU() = %d, want >= 1", cpu)
	}
}
