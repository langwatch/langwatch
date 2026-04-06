package render

import (
	"fmt"
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/clickhouse-serverless/internal/config"
	"github.com/langwatch/langwatch/clickhouse-serverless/internal/storage"
	"github.com/langwatch/langwatch/clickhouse-serverless/internal/users"
)

// RenderAll generates all ClickHouse configuration files under outputDir.
// All output is relative to outputDir — no hardcoded absolute paths.
//
// Output structure:
//
//	outputDir/
//	  config.d/         — ClickHouse server config (limits, storage, keeper, etc.)
//	  users.d/          — ClickHouse user configs (profiles, passwords, custom users)
//	  user-passwords/   — plaintext passwords for custom users (mount as K8s secret)
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

	// Custom users.
	if input.Users != "" {
		if err := renderUsers(input, usersD, outputDir); err != nil {
			return fmt.Errorf("users: %w", err)
		}
		log.Info("custom users configured")
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

func renderUsers(input *config.Input, usersD, outputDir string) error {
	parsed, err := users.ParseUsers(input.Users)
	if err != nil {
		return err
	}

	passwordDir := filepath.Join(outputDir, "user-passwords")
	for _, u := range parsed {
		data, err := users.RenderUser(u)
		if err != nil {
			return fmt.Errorf("render user %s: %w", u.Name, err)
		}
		if err := os.WriteFile(filepath.Join(usersD, u.Name+".yaml"), data, 0600); err != nil {
			return fmt.Errorf("write user %s: %w", u.Name, err)
		}

		userDir := filepath.Join(passwordDir, u.Name)
		if err := os.MkdirAll(userDir, 0700); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(userDir, "password"), []byte(u.Password), 0600); err != nil {
			return err
		}
	}
	return nil
}

// writeYAML marshals data to YAML and writes it with 0600 permissions.
func writeYAML(path string, data any) error {
	out, err := yaml.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(path, out, 0600)
}
