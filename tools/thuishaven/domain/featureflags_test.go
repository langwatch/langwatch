package domain

import (
	"strings"
	"testing"
)

// @scenario "The seed enables the good dev feature flags"
func TestFeatureFlagSeedSQL(t *testing.T) {
	t.Run("given the seeded feature flag set", func(t *testing.T) {
		sql := FeatureFlagSeedSQL()

		t.Run("when building the upsert, it targets the FeatureFlag table", func(t *testing.T) {
			if !strings.Contains(sql, `INSERT INTO "FeatureFlag"`) {
				t.Errorf("sql = %q, want an insert into the FeatureFlag table", sql)
			}
		})

		t.Run("when building the upsert, it enables each seeded flag", func(t *testing.T) {
			for _, key := range SeededFeatureFlags {
				if !strings.Contains(sql, "'"+key+"'") {
					t.Errorf("sql = %q, want it to enable %q", sql, key)
				}
			}
		})

		t.Run("when building the upsert, it enables Langy, governance, and analytics", func(t *testing.T) {
			for _, key := range []string{
				"release_langy_enabled",
				"release_ui_ai_governance_enabled",
				"release_event_sourced_analytics_read",
			} {
				if !strings.Contains(sql, key) {
					t.Errorf("sql = %q, want the good dev flag %q", sql, key)
				}
			}
		})

		t.Run("when re-seeding, the upsert is idempotent on the key", func(t *testing.T) {
			if !strings.Contains(sql, "ON CONFLICT (key) DO UPDATE SET enabled = true") {
				t.Errorf("sql = %q, want an idempotent enable-on-conflict", sql)
			}
		})

		t.Run("when writing raw, it stamps updatedAt (Prisma's @updatedAt is absent)", func(t *testing.T) {
			if !strings.Contains(sql, `"updatedAt" = now()`) {
				t.Errorf("sql = %q, want updatedAt refreshed on a raw write", sql)
			}
		})
	})
}
