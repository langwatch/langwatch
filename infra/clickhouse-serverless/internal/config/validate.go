package config

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Validate checks the Input for invalid or inconsistent values.
// Uses `validate` struct tags for simple rules, plus manual checks for conditional logic.
func (i *Input) Validate() error {
	// Tag-based validation (required, oneof, gte)
	errs := validateStruct(i)

	// TieredMoveFactor must be a float in (0, 1]
	if i.TieredMoveFactor != "" {
		f, err := strconv.ParseFloat(i.TieredMoveFactor, 64)
		if err != nil {
			errs = append(errs, fmt.Sprintf("TIERED_MOVE_FACTOR: invalid float %q", i.TieredMoveFactor))
		} else if math.IsNaN(f) || math.IsInf(f, 0) || f <= 0 || f > 1 {
			errs = append(errs, fmt.Sprintf("TIERED_MOVE_FACTOR: must be in (0, 1] (got %v)", f))
		}
	}

	// The LWQL database name is interpolated into config tag names (the
	// <databases> row-filter section) and into GRANT statements, so anything
	// that is not a plain identifier must fail the render rather than produce
	// malformed config or an unintended grant (mirrors render-config.sh).
	if i.LWQLDatabase != "" && !IsPlainIdentifier(i.LWQLDatabase) {
		errs = append(errs, fmt.Sprintf("CLICKHOUSE_LWQL_DATABASE: not a plain identifier: %q", i.LWQLDatabase))
	}

	// Conditional: replicated fields required when CH_REPLICATED=true
	if i.Replicated {
		if err := validateReplicated(i); err != nil {
			errs = append(errs, err...)
		}
	}

	// Conditional: object storage fields validated when cold storage or backups are enabled
	if i.ColdEnabled || i.BackupEnabled {
		if err := validateObjectStorage(i); err != nil {
			errs = append(errs, err...)
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("configuration errors:\n  - %s", strings.Join(errs, "\n  - "))
	}
	return nil
}

func validateReplicated(i *Input) []string {
	var errs []string
	if strings.TrimSpace(i.KeeperNodes) == "" {
		errs = append(errs, "CH_KEEPER_NODES is required when CH_REPLICATED=true (comma-separated keeper hostnames)")
	}
	if strings.TrimSpace(i.Replica) == "" {
		errs = append(errs, "CH_REPLICA is required when CH_REPLICATED=true (unique replica name, e.g. hostname)")
	}
	if strings.TrimSpace(i.DataNodes) == "" {
		errs = append(errs, "CH_DATA_NODES is required when CH_REPLICATED=true (comma-separated data node hostnames)")
	}
	return errs
}

// IsPlainIdentifier reports whether s is a non-empty run of [A-Za-z0-9_], the
// same character class render-config.sh enforces before interpolating a name
// into config tag names or GRANT statements.
func IsPlainIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_':
		default:
			return false
		}
	}
	return true
}

func validateObjectStorage(i *Input) []string {
	var errs []string

	accessKey := strings.TrimSpace(i.S3AccessKey)
	secretKey := strings.TrimSpace(i.S3SecretKey)

	if (accessKey != "") != (secretKey != "") {
		errs = append(errs, "S3_ACCESS_KEY and S3_SECRET_KEY must both be set or both empty")
	}

	return errs
}
