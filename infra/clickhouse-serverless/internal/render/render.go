package render

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/storage"
)

// RenderAll generates all ClickHouse configuration files under outputDir.
// All output is relative to outputDir — no hardcoded absolute paths.
//
// Output structure:
//
//	outputDir/
//	  config.d/         — ClickHouse server config (limits, storage, keeper, etc.)
//	  users.d/          — ClickHouse user configs (profiles, passwords, custom users)
func RenderAll(log *zap.Logger, input *config.Input, computed *config.Computed, outputDir string) error {
	if input == nil {
		return fmt.Errorf("input must not be nil")
	}
	if log == nil {
		return fmt.Errorf("logger must not be nil")
	}
	if computed == nil {
		return fmt.Errorf("computed settings must not be nil")
	}
	configD := filepath.Join(outputDir, "config.d")
	usersD := filepath.Join(outputDir, "users.d")

	for _, dir := range []string{configD, usersD} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("mkdir %s: %w", dir, err)
		}
	}

	config.ApplyOverrides(log, computed)

	// Core config files (ordered slice for deterministic rendering).
	type step struct {
		name string
		fn   func() error
	}
	for _, s := range []step{
		{"limits", func() error { return renderLimits(input, computed, configD) }},
		{"profiles", func() error { return renderProfiles(computed, usersD) }},
		{"password", func() error { return renderDefaultPassword(input, usersD) }},
		{"tiers", func() error { return renderTiers(input, computed, usersD) }},
		{"logging", func() error { return renderLogging(input, configD) }},
		{"network", func() error { return renderNetwork(computed, configD) }},
		{"custom-settings-prefixes", func() error { return renderCustomSettingsPrefixes(configD) }},
		{"access-control", func() error { return renderAccessControl(input, configD) }},
	} {
		if err := s.fn(); err != nil {
			return fmt.Errorf("%s: %w", s.name, err)
		}
	}

	// Conditional files: rendered when enabled, otherwise a copy left by an
	// earlier run is removed. Only these names, never anything else in the
	// directories: a deployment may mount its own files there.
	for _, s := range []struct {
		name    string
		path    string
		enabled bool
		fn      func() error
	}{
		{"access-management", filepath.Join(usersD, accessManagementFile), input.GrantsDefaultAccessManagement(),
			func() error { return renderAccessManagement(usersD) }},
		// No keeper-backed access or named-collection store: the app owns the
		// LangWatchQL access model (issue #8258).
		{"keeper", filepath.Join(configD, "keeper.yaml"), input.Replicated,
			func() error { return renderKeeper(input, configD) }},
		{"interserver", filepath.Join(configD, "interserver.yaml"), input.InterserverPasswordFile != "",
			func() error { return renderInterserver(input, configD) }},
		{"prometheus", filepath.Join(configD, "prometheus.yaml"), input.EnablePrometheus,
			func() error { return renderPrometheus(configD) }},
		{"storage", filepath.Join(configD, "storage.yaml"), input.ColdEnabled || input.BackupEnabled,
			func() error { return renderStorage(input, computed, configD) }},
	} {
		if !s.enabled {
			if err := os.Remove(s.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return fmt.Errorf("%s: remove stale %s: %w", s.name, s.path, err)
			}
			continue
		}
		if err := s.fn(); err != nil {
			return fmt.Errorf("%s: %w", s.name, err)
		}
	}

	if w := input.WeakPasswordWarning(); w != "" {
		log.Warn(w)
	}
	if input.Replicated && !input.ClusterSecretEnabled {
		log.Warn("remote_servers carries no cluster secret; set CLICKHOUSE_CLUSTER_SECRET_ENABLED=true " +
			"to apply CLICKHOUSE_CLUSTER_SECRET_FILE (README: Cluster secret)")
	}
	if input.ColdEnabled {
		log.Info("cold storage configured")
	}
	if input.BackupEnabled {
		log.Info("backups configured")
	}

	log.Info("configuration rendered", zap.String("dir", outputDir))
	return nil
}

func renderStorage(input *config.Input, computed *config.Computed, configD string) error {
	data, err := storage.Render(input, computed)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(configD, "storage.yaml"), data, 0600)
}

// writeYAML marshals data to YAML and writes it with 0600 permissions.
func writeYAML(path string, data any) error {
	out, err := yaml.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(path, out, 0600)
}
