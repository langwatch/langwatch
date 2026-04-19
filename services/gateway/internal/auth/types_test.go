package auth

import (
	"encoding/json"
	"testing"
)

// TestBudgetSpec_UnmarshalJSON_StringDecimal covers finding #30: the
// control plane serialises Prisma Decimal columns
// (GatewayBudget.limitUsd) as JSON strings to preserve precision.
// Before this fix, any /config/:vk_id payload containing budgets with
// string-encoded amounts failed to decode — cascading to a "no VK
// config loaded" 400 on every dispatch against that VK.
func TestBudgetSpec_UnmarshalJSON_StringDecimal(t *testing.T) {
	cases := []struct {
		name      string
		body      string
		wantLimit float64
		wantSpent float64
	}{
		{
			name:      "number form (back-compat, older iterations)",
			body:      `{"scope":"project","window":"month","limit_usd":100.5,"spent_usd":50.25}`,
			wantLimit: 100.5,
			wantSpent: 50.25,
		},
		{
			name:      "string form (Prisma Decimal default)",
			body:      `{"scope":"project","window":"month","limit_usd":"200.0","spent_usd":"12.5"}`,
			wantLimit: 200.0,
			wantSpent: 12.5,
		},
		{
			name:      "mixed form (limit string, spent number)",
			body:      `{"scope":"org","window":"day","limit_usd":"5000","spent_usd":1247.35}`,
			wantLimit: 5000,
			wantSpent: 1247.35,
		},
		{
			name:      "null defaults to zero",
			body:      `{"scope":"vk","window":"hour","limit_usd":null,"spent_usd":null}`,
			wantLimit: 0,
			wantSpent: 0,
		},
		{
			name:      "very-high-precision decimal as string",
			body:      `{"scope":"org","window":"total","limit_usd":"1000000.123456789","spent_usd":"0.000001"}`,
			wantLimit: 1000000.123456789,
			wantSpent: 0.000001,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var s BudgetSpec
			if err := json.Unmarshal([]byte(c.body), &s); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if s.LimitUSD != c.wantLimit {
				t.Errorf("LimitUSD = %v, want %v", s.LimitUSD, c.wantLimit)
			}
			if s.SpentUSD != c.wantSpent {
				t.Errorf("SpentUSD = %v, want %v", s.SpentUSD, c.wantSpent)
			}
		})
	}
}

// TestBudgetSpec_UnmarshalJSON_Malformed exercises the error path so a
// genuinely bad payload surfaces rather than silently zeros out.
func TestBudgetSpec_UnmarshalJSON_Malformed(t *testing.T) {
	body := `{"scope":"project","window":"month","limit_usd":"not-a-number","spent_usd":10}`
	var s BudgetSpec
	if err := json.Unmarshal([]byte(body), &s); err == nil {
		t.Fatalf("expected error for malformed limit_usd, got none")
	}
}
