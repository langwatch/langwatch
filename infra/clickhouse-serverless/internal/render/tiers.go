package render

import (
	"path/filepath"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

const tiersFile = "access-tiers.yaml"

// auditedSettings decide whether a query reaches system.query_log, so no tier
// may change them: a session that did could hide its own queries.
var auditedSettings = []string{
	"log_queries",
	"log_queries_min_type",
	"log_queries_min_query_duration_ms",
	"log_queries_probability",
}

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
		constraints := map[string]any{}
		for _, name := range auditedSettings {
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
		profiles[tier.Name()] = profile
	}
	return writeYAML(filepath.Join(usersD, tiersFile), map[string]any{
		"roles":    roles,
		"profiles": profiles,
	})
}
