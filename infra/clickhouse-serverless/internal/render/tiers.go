package render

import (
	"path/filepath"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

const tiersFile = "access-tiers.yaml"

// renderTiers writes the four tier roles and their settings profiles (ADR-190).
// Every profile inherits default. Read tiers run with readonly=2, which lets
// tools set their own query settings, and constraints stop them raising the caps.
func renderTiers(input *config.Input, c *config.Computed, usersD string) error {
	roles := map[string]any{}
	profiles := map[string]any{}
	memoryCap := map[string]any{"max": c.MaxMemoryUsagePerQuery}
	for _, tier := range access.Tiers {
		roles[tier.Name()] = map[string]any{"grants": map[string]any{"query": tier.RoleGrants()}}
		profile := map[string]any{"profile": "default"}
		switch {
		case tier.ReadOnly():
			profile["readonly"] = 2
			profile["max_execution_time"] = input.ReadTierMaxExecutionTime
			profile["constraints"] = map[string]any{
				"max_execution_time": map[string]any{"max": input.ReadTierMaxExecutionTime},
				"max_memory_usage":   memoryCap,
			}
		case tier == access.TierWrite:
			profile["constraints"] = map[string]any{"max_memory_usage": memoryCap}
		}
		profiles[tier.Name()] = profile
	}
	return writeYAML(filepath.Join(usersD, tiersFile), map[string]any{
		"roles":    roles,
		"profiles": profiles,
	})
}
