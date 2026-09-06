package egress

import "testing"

func TestHostMatchesAny_ExactAndWildcard(t *testing.T) {
	cases := []struct {
		name     string
		host     string
		patterns []string
		want     bool
	}{
		{"exact match", "registry.npmjs.org", []string{"registry.npmjs.org"}, true},
		{"exact miss", "attacker.com", []string{"registry.npmjs.org"}, false},
		{"case-insensitive", "GitHub.com", []string{"github.com"}, true},
		{"trailing dot on host", "github.com.", []string{"github.com"}, true},
		{"trailing dot on pattern", "github.com", []string{"github.com."}, true},
		{"wildcard single label", "a.internal.acme.com", []string{"*.internal.acme.com"}, true},
		{"wildcard rejects bare base", "internal.acme.com", []string{"*.internal.acme.com"}, false},
		{"wildcard rejects two labels", "a.b.internal.acme.com", []string{"*.internal.acme.com"}, false},
		{"wildcard rejects sibling domain", "a.evil.com", []string{"*.internal.acme.com"}, false},
		{"empty host", "", []string{"github.com"}, false},
		{"empty patterns", "github.com", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hostMatchesAny(tc.host, tc.patterns); got != tc.want {
				t.Fatalf("hostMatchesAny(%q, %v) = %v, want %v", tc.host, tc.patterns, got, tc.want)
			}
		})
	}
}

func TestEgressPolicy_DecisionPrecedence(t *testing.T) {
	cases := []struct {
		name   string
		policy egressPolicy
		host   string
		want   egressDecision
	}{
		{
			name:   "no list, floor off — monitor only",
			policy: egressPolicy{},
			host:   "anything.example",
			want:   egressAllowedMonitor,
		},
		{
			name:   "floor host always allowed",
			policy: egressPolicy{allowlist: []string{"only-this.example"}, floor: []string{"github.com"}},
			host:   "github.com",
			want:   egressAllowedFloor,
		},
		{
			name:   "listed host allowed",
			policy: egressPolicy{allowlist: []string{"registry.npmjs.org"}},
			host:   "registry.npmjs.org",
			want:   egressAllowedListed,
		},
		{
			name:   "unlisted host denied when enforcing",
			policy: egressPolicy{allowlist: []string{"registry.npmjs.org"}},
			host:   "attacker.example",
			want:   egressDenied,
		},
		{
			name:   "enforceFloor denies outside floor without a customer list",
			policy: egressPolicy{floor: []string{"github.com"}, enforceFloor: true},
			host:   "attacker.example",
			want:   egressDenied,
		},
		{
			name:   "floor NOT enforced leaves outside-floor monitor-only",
			policy: egressPolicy{floor: []string{"github.com"}, enforceFloor: false},
			host:   "outside.example",
			want:   egressAllowedMonitor,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.policy.decide(tc.host); got != tc.want {
				t.Fatalf("decide(%q) = %q, want %q", tc.host, got, tc.want)
			}
		})
	}
}
