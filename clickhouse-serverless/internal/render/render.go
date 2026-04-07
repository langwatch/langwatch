package render

import (
	"fmt"
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/clickhouse-serverless/internal/storage"
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

	config.ApplyEnvOverrides(log, computed)

	// Core config files (ordered slice for deterministic rendering).
	type step struct {
		name string
		fn   func() error
	}
	for _, s := range []step{
		{"limits", func() error { return renderLimits(input, computed, configD) }},
		{"profiles", func() error { return renderProfiles(computed, usersD) }},
		{"password", func() error { return renderDefaultPassword(input, usersD) }},
		{"logging", func() error { return renderLogging(input, configD) }},
		{"network", func() error { return renderNetwork(computed, configD) }},
	} {
		if err := s.fn(); err != nil {
			return fmt.Errorf("%s: %w", s.name, err)
		}
	}

	// Replicated mode: render zookeeper client, macros, and remote_servers.
	if input.Replicated {
		if err := renderKeeper(input, configD); err != nil {
			return fmt.Errorf("keeper: %w", err)
		}
	}

	if input.EnablePrometheus {
		if err := renderPrometheus(configD); err != nil {
			return fmt.Errorf("prometheus: %w", err)
		}
	}

	// Object storage (cold tiering and/or backups).
	if input.ColdEnabled || input.BackupEnabled {
		if err := renderStorage(input, computed, configD); err != nil {
			return fmt.Errorf("storage: %w", err)
		}
		if input.ColdEnabled {
			log.Info("cold storage configured")
		}
		if input.BackupEnabled {
			log.Info("backups configured")
		}
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
