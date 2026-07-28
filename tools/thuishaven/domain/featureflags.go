package domain

import (
	"fmt"
	"strings"
)

// SeededFeatureFlags are the product feature flags haven flips ON when it seeds
// a local dev stack, so a fresh `haven up` opens on the current feature set
// rather than the shipped-off release defaults. These are the ones a developer
// dogfooding LangWatch wants on out of the box: the Langy assistant, AI
// governance, the AI Gateway menu, and the event-sourced analytics/trigger
// paths the platform is migrating onto.
//
// Keep in sync BY HAND with the PRODUCT/SYSTEM release_* keys in
// src/server/featureFlag/registry.ts (the two live across the Go/TS boundary and
// intentionally can't share a constant). haven writes these straight into the
// FeatureFlag table — `key` is that table's primary key — so the control plane
// resolves them exactly as it would an operator toggle from /ops/feature-flags.
var SeededFeatureFlags = []string{
	"release_langy_enabled",                // the in-product Langy assistant
	"release_ui_ai_governance_enabled",     // personal keys, admin oversight, routing/ingestion UI
	"release_ui_ai_gateway_menu_enabled",   // the AI Gateway menu in the project sidebar
	"release_event_sourced_analytics_read", // analytics reads off the slim event-sourced tables
	"release_es_graph_triggers_firing",     // event-sourced (vs cron) graph-trigger firing
}

// featureFlagSeedEditor is the FeatureFlag.lastEditedBy stamp haven writes, so an
// operator browsing /ops/feature-flags can see which rows the seed set.
const featureFlagSeedEditor = "haven-seed"

// FeatureFlagSeedSQL returns an idempotent upsert that enables SeededFeatureFlags
// in a stack's Postgres. `key` is the FeatureFlag table's primary key, so
// ON CONFLICT (key) turns a re-seed into a safe flip back to enabled (the app
// manages updatedAt via Prisma's @updatedAt, absent on a raw write, so it is set
// here explicitly). Returns "" when there is nothing to seed.
func FeatureFlagSeedSQL() string {
	if len(SeededFeatureFlags) == 0 {
		return ""
	}
	editor := quoteSQLLiteral(featureFlagSeedEditor)
	values := make([]string, 0, len(SeededFeatureFlags))
	for _, key := range SeededFeatureFlags {
		values = append(values, fmt.Sprintf("(%s, true, %s)", quoteSQLLiteral(key), editor))
	}
	return fmt.Sprintf(
		`INSERT INTO "FeatureFlag" (key, enabled, "lastEditedBy") VALUES %s `+
			`ON CONFLICT (key) DO UPDATE SET enabled = true, `+
			`"lastEditedBy" = EXCLUDED."lastEditedBy", "updatedAt" = now();`,
		strings.Join(values, ", "),
	)
}

// quoteSQLLiteral single-quotes a Postgres string literal. haven only ever
// passes fixed [a-z_] flag keys, but quoting keeps the statement well-formed.
func quoteSQLLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
