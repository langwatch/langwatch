package config

import "testing"

func TestParseHumanBytes(t *testing.T) {
	tests := []struct {
		input   string
		want    int64
		wantErr bool
	}{
		// Kubernetes binary suffixes (standard Helm usage)
		{"4Gi", 4294967296, false},
		{"512Mi", 536870912, false},
		{"1Ki", 1024, false},
		// SI decimal suffixes (k8s standard: G=10^9, M=10^6)
		{"8G", 8000000000, false},
		{"512M", 512000000, false},
		// Raw bytes
		{"4294967296", 4294967296, false},
		{"0", 0, false},
		// Fractional binary
		{"1.5Gi", 1610612736, false},
		// Errors
		{"", 0, true},
		{"abc", 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := ParseHumanBytes(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseHumanBytes(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("ParseHumanBytes(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseCPU(t *testing.T) {
	tests := []struct {
		input   string
		want    int
		wantErr bool
	}{
		// Whole cores
		{"1", 1, false},
		{"2", 2, false},
		{"4", 4, false},
		// Millicores
		{"500m", 1, false},   // 0.5 → rounded up to min 1
		{"1000m", 1, false},
		{"1500m", 2, false},
		{"2000m", 2, false},
		{"100m", 1, false},   // min 1
		// Errors
		{"", 0, true},
		{"abc", 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := ParseCPU(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseCPU(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("ParseCPU(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}
