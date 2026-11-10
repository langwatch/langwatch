package render

import (
	"path/filepath"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

const tiersFile = "access-tiers.yaml"

// renderTiers writes the four tier roles and their settings profiles (ADR-198).
// Every profile inherits default. Read tiers run with readonly=2, which lets
// tools set their own query settings, and constraints stop them raising the caps.
func renderTiers(input *config.Input, c *config.Computed, usersD string) error {
	roles := map[string]any{}
	profiles := map[string]any{}
	memoryCap := map[string]any{"max": c.MaxMemoryUsagePerQuery}
	// The access file's policy may add to or replace the protected settings; a
	// change takes a restart, as the tiers render only at startup.
	protected := access.AuditedSettings
	if input.AccessPolicy != nil {
		protected = input.AccessPolicy.Rules().Protected
	}
	for _, tier := range access.Tiers {
		roles[tier.Name()] = map[string]any{"grants": map[string]any{"query": tier.RoleGrants()}}
		profile := map[string]any{}
		constraints := map[string]any{}
		for _, name := range protected {
			constraints[name] = map[string]any{"const": ""}
		}
		switch {
		case tier.ReadOnly():
			profile["readonly"] = 2
			profile["max_execution_time"] = input.ReadTierMaxExecutionTime
			constraints["max_execution_time"] = map[string]any{"max": input.ReadTierMaxExecutionTime}
			constraints["max_memory_usage"] = memoryCap
		case tier == access.TierWrite:
			constraints["max_memory_usage"] = memoryCap
		}
		profile["constraints"] = constraints
		profiles[tier.Name()] = access.Profile{Parent: "default", Settings: profile}
	}
	return writeYAML(filepath.Join(usersD, tiersFile), map[string]any{
		"roles":    roles,
		"profiles": profiles,
	})
}
