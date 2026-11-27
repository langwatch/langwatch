package ssrf

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNamesLoopback(t *testing.T) {
	for host, want := range map[string]bool{
		"localhost":                   true,
		"LOCALHOST.":                  true,
		"llm.dev.langwatch.localhost": true,
		"127.0.0.1":                   true,
		"127.8.9.10":                  true,
		"::1":                         true,
		"[::1]":                       true,
		"::ffff:127.0.0.1":            true,
		"localhost.example.com":       false,
		"notlocalhost":                false,
		"10.0.0.1":                    false,
		"rebind.example":              false,
		"":                            false,
	} {
		assert.Equal(t, want, NamesLoopback(host), host)
	}
}

func TestPinnedDialerResolvesOnceAndConnectsOnlyToWhatItChecked(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	_, port, _ := net.SplitHostPort(ln.Addr().String())

	lookups := 0
	var judged []netip.Addr
	dialer := PinnedDialer{
		Lookup: func(context.Context, string) ([]netip.Addr, error) {
			lookups++
			return []netip.Addr{netip.MustParseAddr("::1"), netip.MustParseAddr("127.0.0.1")}, nil
		},
		Check: func(_ string, addrs []netip.Addr) error {
			judged = addrs
			return nil
		},
	}
	conn, err := dialer.DialContext(context.Background(), "tcp", net.JoinHostPort("agent.example", port))
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })

	assert.Equal(t, 1, lookups, "one dial resolves the name once")
	assert.Len(t, judged, 2, "every address is judged before any connection")
	assert.Equal(t, ln.Addr().String(), conn.RemoteAddr().String())
}

func TestPinnedDialerRefusesWithoutConnectingWhenAnyAddressFails(t *testing.T) {
	refused := errors.New("refused")
	dialer := PinnedDialer{
		Lookup: func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("93.184.216.34"), netip.MustParseAddr("127.0.0.1")}, nil
		},
		Check: func(_ string, addrs []netip.Addr) error {
			for _, addr := range addrs {
				if addr.IsLoopback() {
					return refused
				}
			}
			return nil
		},
	}
	_, err := dialer.DialContext(context.Background(), "tcp", "rebind.example:80")
	require.ErrorIs(t, err, refused)
}

func TestPinnedDialerJudgesALiteralWithoutALookup(t *testing.T) {
	dialer := PinnedDialer{
		Lookup: func(context.Context, string) ([]netip.Addr, error) {
			t.Fatal("a literal address is never looked up")
			return nil, nil
		},
		Check: func(host string, addrs []netip.Addr) error {
			assert.Equal(t, "169.254.169.254", host)
			assert.Equal(t, []netip.Addr{netip.MustParseAddr("169.254.169.254")}, addrs)
			return errors.New("refused")
		},
	}
	_, err := dialer.DialContext(context.Background(), "tcp", "169.254.169.254:80")
	require.Error(t, err)
}
