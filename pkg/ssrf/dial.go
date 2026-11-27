package ssrf

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"time"
)

// Lookup resolves a host name to its addresses.
type Lookup func(ctx context.Context, host string) ([]netip.Addr, error)

// SystemLookup resolves through the system resolver.
func SystemLookup(ctx context.Context, host string) ([]netip.Addr, error) {
	return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
}

// Check judges every address one dial resolved for host, the name the caller
// asked for. A nil error admits all of them.
type Check func(host string, addrs []netip.Addr) error

// ErrNoUsableAddress is returned when no checked address fits the network.
var ErrNoUsableAddress = errors.New("no checked address fits the network")

// defaultDialTimeout bounds a dial whose base dialer sets no timeout.
const defaultDialTimeout = 30 * time.Second

// PinnedDialer resolves a host once, judges every address with Check, then
// connects only to an address it judged, falling back across them in order.
// Nothing resolves the name a second time, so DNS rebinding cannot choose the
// destination after the decision (the TypeScript twin is fenced-fetch.ts).
type PinnedDialer struct {
	Dialer *net.Dialer
	Lookup Lookup
	Check  Check
}

// DialContext dials address ("host:port") at a judged address.
func (d PinnedDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addrs, err := d.resolve(ctx, host)
	if err != nil {
		return nil, err
	}
	if err := d.Check(host, addrs); err != nil {
		return nil, err
	}
	return d.dialEach(ctx, network, checkedTarget{addrs: usable(network, addrs), port: port})
}

func (d PinnedDialer) resolve(ctx context.Context, host string) ([]netip.Addr, error) {
	if addr, err := netip.ParseAddr(host); err == nil {
		return []netip.Addr{addr}, nil
	}
	lookup := d.Lookup
	if lookup == nil {
		lookup = SystemLookup
	}
	return lookup(ctx, host)
}

// usable keeps the addresses a tcp4 or tcp6 dial can reach.
func usable(network string, addrs []netip.Addr) []netip.Addr {
	if !strings.HasSuffix(network, "4") && !strings.HasSuffix(network, "6") {
		return addrs
	}
	kept := make([]netip.Addr, 0, len(addrs))
	for _, addr := range addrs {
		if is4 := addr.Unmap().Is4(); is4 == strings.HasSuffix(network, "4") {
			kept = append(kept, addr)
		}
	}
	return kept
}

// checkedTarget is the judged addresses of one dial, on one port.
type checkedTarget struct {
	addrs []netip.Addr
	port  string
}

// dialEach gives every remaining address an equal share of the time left, as
// Go's own serial dial does, so one silent address cannot spend all of it.
func (d PinnedDialer) dialEach(ctx context.Context, network string, target checkedTarget) (net.Conn, error) {
	addrs := target.addrs
	if len(addrs) == 0 {
		return nil, ErrNoUsableAddress
	}
	base := d.Dialer
	if base == nil {
		base = &net.Dialer{}
	}
	timeout := base.Timeout
	if timeout <= 0 {
		timeout = defaultDialTimeout
	}
	deadline := time.Now().Add(timeout)
	if dl, ok := ctx.Deadline(); ok && dl.Before(deadline) {
		deadline = dl
	}
	var lastErr error
	for i, addr := range addrs {
		attemptCtx, cancel := context.WithTimeout(ctx, time.Until(deadline)/time.Duration(len(addrs)-i))
		conn, err := base.DialContext(attemptCtx, network, net.JoinHostPort(addr.String(), target.port))
		cancel()
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

// NamesLoopback reports whether host, as a URL spells it, can only mean this
// machine: a loopback literal, "localhost", or a name under ".localhost"
// (RFC 6761). A name that merely resolves to loopback does not count.
func NamesLoopback(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.Trim(host, "[]")), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	addr, err := netip.ParseAddr(host)
	return err == nil && unmap(addr).IsLoopback()
}
