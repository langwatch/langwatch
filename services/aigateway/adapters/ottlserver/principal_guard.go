// Package ottlserver — principal-field guard.
//
// The OTTL server is invoked AFTER the receiver has authenticated the
// inbound IngestionSource (see specs/ai-governance/ingestion-sources/
// trace-attribution-binding.md). Authentication resolves the
// credential to a known IngestionSource, which determines the
// trace's principal-binding attributes (organization_id,
// ingestion_source.id, retention_class, user_id, etc.).
//
// OTTL transforms run AFTER that resolution but BEFORE the receiver
// stamps records into ClickHouse. If a misconfigured (or hostile)
// OTTL rule rewrites a principal-binding attribute, the row that
// lands in storage carries forged attribution — corrupting SIEM
// forensics and the cross-tenant isolation invariant.
//
// Mitigation: snapshot the protected attribute set on every record
// BEFORE running statements; after statements run, restore the
// snapshot value (or remove the key if it was absent pre-transform
// but appeared post-transform). This is a defense-in-depth pass —
// the receiver also re-stamps tenancy at write time, but that
// stamping doesn't cover every protected key, and the OCSF event
// shape relies on these attributes being credential-derived rather
// than payload-derived.
//
// Spec: specs/ai-gateway/governance/ingestion-attribution.feature
package ottlserver

import (
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
)

// protectedAttributeKeys is the closed set of OTel attribute keys
// whose values are derived from the authenticated credential and
// MUST NOT be rewritten by OTTL.
//
// Keep in sync with the TS-side registry at
// langwatch/ee/governance/services/governanceAttributeKeys.ts —
// every key the governance pipeline treats as principal-binding
// belongs here.
var protectedAttributeKeys = []string{
	// Origin discriminator + IngestionSource identity (governance
	// reactors filter on these to decide whether to fold + into
	// which projection bucket).
	"langwatch.origin.kind",
	"langwatch.ingestion_source.id",
	"langwatch.ingestion_source.source_type",
	"langwatch.ingestion_source.organization_id",
	"langwatch.governance.retention_class",
	"langwatch.governance.anomaly_alert_id",

	// User / tenant attribution (used by SpendByUser, OCSF actor
	// fields, /me trace explorer).
	"langwatch.user_id",
	"langwatch.user.id",
	"langwatch.team.id",
	"langwatch.team_id",
	"langwatch.organization_id",
	"langwatch.organization.id",
	"langwatch.project_id",
	"langwatch.project.id",
	"langwatch.tenant_id",

	// Gateway VK path (only present when the gateway stamps the
	// span pre-receive; defensively listed so an OTTL rule that
	// runs over a mixed-source collector batch still can't rewrite
	// the VK reference).
	"langwatch.virtual_key_id",
	"langwatch.virtual_key.id",
}

// snapshotEntry records the pre-OTTL state of one protected key on
// one attribute map. `present=false` means the key was absent — the
// restore pass will delete it if OTTL added it.
type snapshotEntry struct {
	present bool
	value   pcommon.Value
}

type recordSnapshot struct {
	resource map[string]snapshotEntry
	scope    map[string]snapshotEntry
	record   map[string]snapshotEntry
}

// snapshotProtectedAttrs captures the value of every protected key
// across the three attribute maps (resource / scope / record). The
// returned snapshot is consumed by restoreProtectedAttrs.
//
// Values are deep-copied via pcommon.Value.CopyTo so that subsequent
// in-place mutations by OTTL don't bleed into the snapshot.
func snapshotProtectedAttrs(rl plog.ResourceLogs, sl plog.ScopeLogs, lr plog.LogRecord) recordSnapshot {
	return recordSnapshot{
		resource: snapshotMap(rl.Resource().Attributes()),
		scope:    snapshotMap(sl.Scope().Attributes()),
		record:   snapshotMap(lr.Attributes()),
	}
}

func snapshotMap(attrs pcommon.Map) map[string]snapshotEntry {
	out := make(map[string]snapshotEntry, len(protectedAttributeKeys))
	for _, key := range protectedAttributeKeys {
		v, ok := attrs.Get(key)
		if !ok {
			out[key] = snapshotEntry{present: false}
			continue
		}
		// Deep-copy via CopyTo so OTTL's in-place mutation cannot
		// affect the snapshot.
		copied := pcommon.NewValueEmpty()
		v.CopyTo(copied)
		out[key] = snapshotEntry{present: true, value: copied}
	}
	return out
}

// restoreProtectedAttrs writes the snapshot values back over whatever
// OTTL produced, and deletes any protected key that OTTL added when
// the key was absent pre-transform. Safe to call even when the
// snapshot recorded no presence — the no-op path is cheap.
func restoreProtectedAttrs(rl plog.ResourceLogs, sl plog.ScopeLogs, lr plog.LogRecord, snap recordSnapshot) {
	restoreMap(rl.Resource().Attributes(), snap.resource)
	restoreMap(sl.Scope().Attributes(), snap.scope)
	restoreMap(lr.Attributes(), snap.record)
}

func restoreMap(attrs pcommon.Map, snap map[string]snapshotEntry) {
	for key, entry := range snap {
		if !entry.present {
			// OTTL may have added this key; remove to preserve
			// the pre-transform "absent" state.
			attrs.Remove(key)
			continue
		}
		// OTTL may have mutated or removed; overwrite with the
		// snapshot value. PutEmpty + CopyTo is the documented
		// pcommon.Map round-trip.
		dst := attrs.PutEmpty(key)
		entry.value.CopyTo(dst)
	}
}
