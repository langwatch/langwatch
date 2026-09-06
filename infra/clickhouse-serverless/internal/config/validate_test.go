package config

import (
	"strings"
	"testing"
)

func validInput() *Input {
	return &Input{
		CPU:                 2,
		RAMBytes:            4 << 30,
		Password:            "testpass",
		LogLevel:            "warning",
		LogFormat:           "json",
		GroupByOverflowMode: "throw",
	}
}

func TestValidate_ValidInput(t *testing.T) {
	if err := validInput().Validate(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidate_CPUTooLow(t *testing.T) {
	i := validInput()
	i.CPU = 0
	err := i.Validate()
	if err == nil || !strings.Contains(err.Error(), "CPU") {
		t.Errorf("expected CPU error, got: %v", err)
	}
}

func TestValidate_RAMTooLow(t *testing.T) {
	i := validInput()
	i.RAMBytes = 256 << 20
	err := i.Validate()
	if err == nil || !strings.Contains(err.Error(), "RAMBytes") {
		t.Errorf("expected RAMBytes error, got: %v", err)
	}
}

func TestValidate_PasswordRequired(t *testing.T) {
	i := validInput()
	i.Password = ""
	err := i.Validate()
	if err == nil || !strings.Contains(err.Error(), "CLICKHOUSE_PASSWORD") {
		t.Errorf("expected password error, got: %v", err)
	}
}

func TestValidate_InvalidLogLevel(t *testing.T) {
	i := validInput()
	i.LogLevel = "verbose"
	err := i.Validate()
	if err == nil || !strings.Contains(err.Error(), "LOG_LEVEL") {
		t.Errorf("expected LOG_LEVEL error, got: %v", err)
	}
}

func TestValidate_S3NotRequiredWithoutColdOrBackup(t *testing.T) {
	i := validInput()
	i.ColdEnabled = false
	i.BackupEnabled = false
	i.S3AccessKey = "partial" // would be invalid with cold/backup, but fine without
	if err := i.Validate(); err != nil {
		t.Errorf("S3 validation should not trigger without cold storage or backups: %v", err)
	}
}

func TestValidate_S3ValidatedWithBackupEnabled(t *testing.T) {
	i := validInput()
	i.BackupEnabled = true
	i.S3AccessKey = "AKID"
	i.S3SecretKey = ""
	err := i.Validate()
	if err == nil || !strings.Contains(err.Error(), "S3_ACCESS_KEY") {
		t.Errorf("expected S3 credential error with backup enabled, got: %v", err)
	}
}

func TestValidate_PartialS3CredentialsWithCold(t *testing.T) {
	i := validInput()
	i.ColdEnabled = true
	i.S3AccessKey = "AKID"
	i.S3SecretKey = ""
	err := i.Validate()
	if err == nil || !strings.Contains(err.Error(), "S3_ACCESS_KEY") {
		t.Errorf("expected S3 credential error, got: %v", err)
	}
}


func TestValidate_MultipleErrors(t *testing.T) {
	i := &Input{
		CPU:                 0,
		RAMBytes:            100,
		LogLevel:            "bad",
		LogFormat:           "bad",
		GroupByOverflowMode: "bad",
	}
	err := i.Validate()
	if err == nil {
		t.Fatal("expected errors")
	}
	if strings.Count(err.Error(), "\n") < 3 {
		t.Errorf("expected multiple errors, got: %v", err)
	}
}

func TestValidate_TieredMoveFactor(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{"valid 0.5", "0.5", false},
		{"valid 0.9", "0.9", false},
		{"valid 1.0 (upper bound)", "1", false},
		{"empty (skipped)", "", false},
		{"zero (out of range)", "0", true},
		{"negative", "-0.5", true},
		{"above 1", "1.1", true},
		{"not a number", "abc", true},
		{"NaN", "NaN", true},
		{"Inf", "Inf", true},
		{"-Inf", "-Inf", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			i := validInput()
			i.TieredMoveFactor = tt.value
			err := i.Validate()
			if tt.wantErr && err == nil {
				t.Error("expected error")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

