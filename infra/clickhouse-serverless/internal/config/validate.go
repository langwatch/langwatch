package config

import (
	"fmt"
	"math"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
)

// Validate checks the Input for invalid or inconsistent values.
// Uses `validate` struct tags for simple rules, plus manual checks for conditional logic.
func (i *Input) Validate() error {
	// Tag-based validation (required, oneof, gte)
	errs := validateStruct(i)

	// As before, only an empty password is refused; a published or blank-looking
	// one starts with a warning (WeakPasswordWarning).
	switch {
	case i.DynamicOnly:
		errs = append(errs, i.dynamicOnlyErrors()...)
	case i.Password == "":
		errs = append(errs, "CLICKHOUSE_PASSWORD or CLICKHOUSE_PASSWORD_FILE must set a password for the default user")
	}

	// TieredMoveFactor must be a float in (0, 1]
	if i.TieredMoveFactor != "" {
		f, err := strconv.ParseFloat(i.TieredMoveFactor, 64)
		if err != nil {
			errs = append(errs, fmt.Sprintf("TIERED_MOVE_FACTOR: invalid float %q", i.TieredMoveFactor))
		} else if math.IsNaN(f) || math.IsInf(f, 0) || f <= 0 || f > 1 {
			errs = append(errs, fmt.Sprintf("TIERED_MOVE_FACTOR: must be in (0, 1] (got %v)", f))
		}
	}

	if i.AccessFile != "" {
		if err := access.ValidateListen(i.AccessListen); err != nil {
			errs = append(errs, err.Error())
		}
	}

	if i.InterserverPasswordFile != "" && strings.TrimSpace(i.InterserverUser) == "" {
		errs = append(errs, "CLICKHOUSE_INTERSERVER_USER must not be empty when CLICKHOUSE_INTERSERVER_PASSWORD_FILE is set")
	}

	if i.ClusterSecretEnabled && strings.TrimSpace(i.ClusterSecretFile) == "" {
		errs = append(errs, "CLICKHOUSE_CLUSTER_SECRET_FILE is required when CLICKHOUSE_CLUSTER_SECRET_ENABLED=true")
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

func validateObjectStorage(i *Input) []string {
	var errs []string

	accessKey := strings.TrimSpace(i.S3AccessKey)
	secretKey := strings.TrimSpace(i.S3SecretKey)

	if (accessKey != "") != (secretKey != "") {
		errs = append(errs, "S3_ACCESS_KEY and S3_SECRET_KEY must both be set or both empty")
	}

	return errs
}

// dynamicOnlyErrors are the inputs dynamic-only mode refuses (ADR-184).
func (i *Input) dynamicOnlyErrors() []string {
	var errs []string
	const mode = "dynamic-only mode (access.yaml): "
	if i.Password != "" {
		errs = append(errs, mode+"unset CLICKHOUSE_PASSWORD and CLICKHOUSE_PASSWORD_FILE; "+
			"the default user gets no password and no network, logins are tokens only")
	}
	if !filepath.IsAbs(i.AccessBootstrapDir) {
		errs = append(errs, mode+"CLICKHOUSE_ACCESS_BOOTSTRAP_DIR must be an absolute path (mount a tmpfs there)")
	}
	if i.Replicated && !i.ClusterSecretEnabled {
		errs = append(errs, mode+"set CLICKHOUSE_CLUSTER_SECRET_ENABLED=true; without the cluster secret "+
			"replicas log in to each other as default, which is locked")
	}
	return errs
}
