package ssrf

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"sync"
	"syscall"
	"testing"
	"time"

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

// @scenario "The HTTP block falls back across the addresses it checked"
func TestPinnedDialerStartsTheDeadlineBeforeTheLookup(t *testing.T) {
	dialer := PinnedDialer{
		Dialer: &net.Dialer{Timeout: 100 * time.Millisecond},
		Lookup: func(ctx context.Context, _ string) ([]netip.Addr, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
		Check: func(string, []netip.Addr) error { return nil },
	}
	done := make(chan error, 1)
	go func() {
		_, err := dialer.DialContext(context.Background(), "tcp", "slow-dns.example:80")
		done <- err
	}()
	select {
	case err := <-done:
		require.ErrorIs(t, err, context.DeadlineExceeded)
	case <-time.After(2 * time.Second):
		t.Fatal("the dial timeout did not bound the lookup")
	}
}

// stallingControl holds every connect to one address until the attempt's
// context ends, and every other connect for delay, so a test can tell a
// staggered dial from a serial one by the clock alone.
func stallingControl(silent string, delay time.Duration) func(context.Context, string, string, syscall.RawConn) error {
	return func(ctx context.Context, _ string, address string, _ syscall.RawConn) error {
		host, _, _ := net.SplitHostPort(address)
		wait := delay
		if host == silent {
			wait = time.Hour
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
			return nil
		}
	}
}

// @scenario "The HTTP block falls back across the addresses it checked"
func TestPinnedDialerStartsTheOtherFamilyWhileTheFirstIsStillSilent(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	_, port, _ := net.SplitHostPort(ln.Addr().String())

	// Serially, ::1 spends half of the 2s and 127.0.0.1 needs 1.2s of the 1s
	// left. Started 300ms in, 127.0.0.1 connects at about 1.5s.
	dialer := PinnedDialer{
		Dialer: &net.Dialer{Timeout: 2 * time.Second, ControlContext: stallingControl("::1", 1200*time.Millisecond)},
		Lookup: func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("::1"), netip.MustParseAddr("127.0.0.1")}, nil
		},
		Check: func(string, []netip.Addr) error { return nil },
	}
	conn, err := dialer.DialContext(context.Background(), "tcp", net.JoinHostPort("dual.example", port))
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	assert.Equal(t, ln.Addr().String(), conn.RemoteAddr().String())
}

// @scenario "The HTTP block falls back across the addresses it checked"
func TestPinnedDialerNeverStaggersAddressesOfOneFamily(t *testing.T) {
	var mu sync.Mutex
	var dialed []string
	dialer := PinnedDialer{
		Dialer: &net.Dialer{Timeout: 200 * time.Millisecond, ControlContext: func(ctx context.Context, _ string, address string, _ syscall.RawConn) error {
			mu.Lock()
			dialed = append(dialed, address)
			mu.Unlock()
			<-ctx.Done()
			return ctx.Err()
		}},
		Lookup: func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("192.0.2.1"), netip.MustParseAddr("192.0.2.2")}, nil
		},
		Check: func(string, []netip.Addr) error { return nil },
	}
	_, err := dialer.DialContext(context.Background(), "tcp", "one-family.example:80")
	require.Error(t, err)
	assert.Equal(t, []string{"192.0.2.1:80", "192.0.2.2:80"}, dialed, "one family is dialed in order, one at a time")
}
