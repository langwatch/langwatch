// Package access defines the image's privilege tiers, reads access.yaml, plans
// the users it declares and verifies their token logins (ADR-190).
package access

import (
	"fmt"
	"strings"
)

// Tier is what a user may do; its database list says where.
type Tier string

const (
	TierInspect Tier = "inspect"
	TierRead    Tier = "read"
	TierWrite   Tier = "write"
	TierAdmin   Tier = "admin"
)

// Tiers lists every tier in privilege order.
var Tiers = []Tier{TierInspect, TierRead, TierWrite, TierAdmin}

// ParseTier returns the tier named s.
func ParseTier(s string) (Tier, error) {
	for _, t := range Tiers {
		if string(t) == s {
			return t, nil
		}
	}
	return "", fmt.Errorf("unknown tier %q (want inspect, read, write or admin)", s)
}

// Name is the role and settings profile the tier renders as.
func (t Tier) Name() string { return "tier_" + string(t) }

// TakesDatabases reports whether a user of this tier lists its databases.
// Inspect sees every name and no rows; admin holds everything.
func (t Tier) TakesDatabases() bool { return t == TierRead || t == TierWrite }

// ReadOnly reports whether the tier's profile runs with readonly=2.
func (t Tier) ReadOnly() bool { return t == TierInspect || t == TierRead }

// RoleGrants are the tier role's database-independent grants.
func (t Tier) RoleGrants() []string {
	if t == TierAdmin {
		return []string{"GRANT ALL ON *.* WITH GRANT OPTION"}
	}
	// Names only. Rows of system tables that hold query text (query_log and
	// its peers) stay closed: select_from_system_db_requires_grant is on.
	return []string{
		"GRANT SHOW ON *.*",
		"GRANT SELECT ON information_schema.*",
		"GRANT SELECT ON INFORMATION_SCHEMA.*",
	}
}

// UserGrants are the grants a user of this tier gets: its role, then its
// privileges on each listed database. Lightweight DELETE checks ALTER DELETE.
func (t Tier) UserGrants(databases []string) []string {
	grants := []string{"GRANT " + t.Name()}
	var privileges string
	switch t {
	case TierRead:
		privileges = "SELECT"
	case TierWrite:
		privileges = "SELECT, INSERT, ALTER UPDATE, ALTER DELETE"
	default:
		return grants
	}
	for _, db := range databases {
		grants = append(grants, fmt.Sprintf("GRANT %s ON %s.*", privileges, quoteIdentifier(db)))
	}
	return grants
}

// quoteIdentifier backquotes a validated identifier.
func quoteIdentifier(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}
