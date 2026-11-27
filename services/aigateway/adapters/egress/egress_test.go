package egress

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCheckDialRefusesWhatThePolicyDoesNotAllow(t *testing.T) {
	cases := []struct {
		address    string
		blockLocal bool
		allowed    bool
	}{
		{"8.8.8.8:443", true, true},
		{"127.0.0.1:80", true, false},
		{"127.0.0.1:80", false, true},
		{"10.0.0.5:80", true, false},
		{"169.254.169.254:80", false, false},
		{"[fe80::1]:80", false, false},
		{"0.0.0.0:80", false, false},
		{"168.63.129.16:80", false, false},
		{"[::ffff:169.254.169.254]:80", false, false},
		{"not-an-address", false, false},
		{"llm.internal:443", false, false},
	}
	for _, tc := range cases {
		err := NewPolicy(tc.blockLocal, nil).CheckDial(tc.address, "")
		if tc.allowed {
			assert.NoError(t, err, tc.address)
		} else {
			assert.ErrorIs(t, err, ErrBlocked, tc.address)
		}
	}
}

func TestAllowlistExemptsOnlyFromBlockLocal(t *testing.T) {
	policy := NewPolicy(true, []string{" LLM.internal. ", "10.0.0.5"})

	assert.True(t, policy.Allowlisted("llm.internal"))
	require.NoError(t, policy.CheckDial("10.0.0.9:443", "llm.internal"))
	require.NoError(t, policy.CheckDial("10.0.0.5:443", "10.0.0.5"))
	require.ErrorIs(t, policy.CheckDial("10.0.0.5:443", "other.internal"), ErrBlocked,
		"an allowlisted IP admits a URL that names it, never a name that resolves to it")
	require.ErrorIs(t, policy.CheckDial("10.0.0.9:443", "other.internal"), ErrBlocked)
	require.ErrorIs(t, policy.CheckDial("169.254.169.254:80", "llm.internal"), ErrBlocked)
}
