package cell

import (
	"context"
	"fmt"
)

// OverlayHeldTenants plants only the tenant-oddities overlay's held organization (UM-06): a legacy ssoDomain that a
// second organization's connection proved on main, so head's grandfather step holds that organization alone. SSO profiles only.
const OverlayHeldTenants = "held-tenants"

// heldOnly: the held organization is planted without the rest of tenant-oddities.
func (cell *run) heldOnly() bool {
	return cell.overlay(OverlayHeldTenants) && !cell.overlay(OverlayTenantOddities)
}

// plantHeldTenant plants the held organization as tenant-oddities does and reads its standing on main.
func (cell *run) plantHeldTenant(ctx context.Context) error {
	odd := &cell.odd
	if odd.err = cell.plantHeld(ctx); odd.err != nil {
		return odd.err
	}
	odd.before = cell.readOddFacts(ctx, false)
	if odd.err = odd.before.ReadErr; odd.err != nil {
		return odd.err
	}
	cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("held tenants: %s (ssoDomain %s, a domain organization SAML's connection proved); grandfather states on main %v",
		odd.held.org, samlDomain, odd.before.HeldStates))
	return nil
}

// heldTenantVerdicts (A1) judge the held organization alone, when tenant-oddities did not plant it.
func (cell *run) heldTenantVerdicts(ctx context.Context) []Verdict {
	if !cell.heldOnly() {
		return nil
	}
	if cell.odd.err != nil || cell.odd.held.org == "" {
		reason := "not planted"
		if cell.odd.err != nil {
			reason = cell.odd.err.Error()
		}
		return []Verdict{verdict("A1", false, "planting on main stopped: "+reason)}
	}
	return []Verdict{judgeHeld(cell.odd.held.org, cell.readOddFacts(ctx, true))}
}
