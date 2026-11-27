package egress

import (
	"context"
	"net"
	"net/netip"
	"testing"
	"time"

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
		{"[fd00:ec2::254%eth0]:80", false, false},
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

// @scenario "Loopback is reached only through a loopback name or the allowlist"
func TestLoopbackIsReachedOnlyThroughALoopbackNameOrTheAllowlist(t *testing.T) {
	cases := []struct {
		name     string
		policy   Policy
		address  string
		dialHost string
		allowed  bool
	}{
		{"a public name rebound to loopback, local calls allowed", NewPolicy(false, nil), "127.0.0.1:80", "rebind.example", false},
		{"a public name rebound to IPv6 loopback, local calls allowed", NewPolicy(false, nil), "[::1]:80", "rebind.example", false},
		{"a mapped loopback address, local calls allowed", NewPolicy(false, nil), "[::ffff:127.0.0.1]:80", "rebind.example", false},
		{"the loopback literal itself, local calls allowed", NewPolicy(false, nil), "127.0.0.1:80", "127.0.0.1", true},
		{"localhost, local calls allowed", NewPolicy(false, nil), "127.0.0.1:80", "localhost", true},
		{"a .localhost name, local calls allowed", NewPolicy(false, nil), "[::1]:80", "llm.dev.langwatch.localhost", true},
		{"localhost, local calls blocked", NewPolicy(true, nil), "127.0.0.1:80", "localhost", false},
		{"an allowlisted name that resolves to loopback", NewPolicy(true, []string{"rebind.example"}), "127.0.0.1:80", "rebind.example", true},
		{"a private address is unchanged, local calls allowed", NewPolicy(false, nil), "10.0.0.5:80", "rebind.example", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.policy.CheckDial(tc.address, tc.dialHost)
			if tc.allowed {
				assert.NoError(t, err)
			} else {
				assert.ErrorIs(t, err, ErrBlocked)
			}
		})
	}
}

func loopbackLookup(context.Context, string) ([]netip.Addr, error) {
	return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
}

// @scenario "A provider endpoint that resolves to loopback only at connect time is not reached"
func TestDialerDoesNotConnectToLoopbackThroughARebindingName(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	_, port, _ := net.SplitHostPort(ln.Addr().String())

	refusing := NewPolicy(false, nil).WithLookup(loopbackLookup).Dialer(time.Second)
	_, err = refusing.DialContext(context.Background(), "tcp", net.JoinHostPort("rebind.example", port))
	require.ErrorIs(t, err, ErrBlocked)

	admitting := NewPolicy(false, []string{"rebind.example"}).WithLookup(loopbackLookup).Dialer(time.Second)
	conn, err := admitting.DialContext(context.Background(), "tcp", net.JoinHostPort("rebind.example", port))
	require.NoError(t, err, "an allowlisted name still reaches loopback")
	_ = conn.Close()
}
