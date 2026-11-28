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

// defaultFallbackDelay is how long the first address family gets before the
// other one starts, net.Dialer's own default (RFC 6555).
const defaultFallbackDelay = 300 * time.Millisecond

// PinnedDialer resolves a host once, judges every address with Check, then
// connects only to an address it judged, falling back across them in order.
// Nothing resolves the name a second time, so DNS rebinding cannot choose the
// destination after the decision (the TypeScript twin is fenced-fetch.ts).
type PinnedDialer struct {
	Dialer *net.Dialer
	Lookup Lookup
	Check  Check
}

// DialContext dials address ("host:port") at a judged address. One deadline
// covers the lookup and every connection attempt, as with net.Dialer.
func (d PinnedDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	base := d.base()
	timeout := base.Timeout
	if timeout <= 0 {
		timeout = defaultDialTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	addrs, err := d.resolve(ctx, host)
	if err != nil {
		return nil, err
	}
	if err := d.Check(host, addrs); err != nil {
		return nil, err
	}
	return dialer{base: base, network: network}.checked(ctx, checkedTarget{addrs: usable(network, addrs), port: port})
}

func (d PinnedDialer) base() *net.Dialer {
	if d.Dialer == nil {
		return &net.Dialer{}
	}
	return d.Dialer
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

// byFamily splits the addresses into the first one's family and the rest,
// each in resolver order.
func (t checkedTarget) byFamily() (primaries, fallbacks checkedTarget) {
	primaries, fallbacks = checkedTarget{port: t.port}, checkedTarget{port: t.port}
	for _, addr := range t.addrs {
		if addr.Unmap().Is4() == t.addrs[0].Unmap().Is4() {
			primaries.addrs = append(primaries.addrs, addr)
		} else {
			fallbacks.addrs = append(fallbacks.addrs, addr)
		}
	}
	return primaries, fallbacks
}

// dialer is one dial's base dialer and network.
type dialer struct {
	base    *net.Dialer
	network string
}

// checked starts the other address family once the first has had the
// fallback delay or failed, as net.Dialer does; the first connection wins.
func (d dialer) checked(ctx context.Context, target checkedTarget) (net.Conn, error) {
	if len(target.addrs) == 0 {
		return nil, ErrNoUsableAddress
	}
	primaries, fallbacks := target.byFamily()
	if len(fallbacks.addrs) == 0 || d.base.FallbackDelay < 0 {
		return d.each(ctx, target)
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	r := race{dialer: d, results: make(chan dialResult, 2), primaryFailed: make(chan struct{})}
	go r.primary(ctx, primaries)
	go r.fallback(ctx, fallbacks)
	return r.winner()
}

// each gives every remaining address an equal share of the time left, as
// Go's own serial dial does, so one silent address cannot spend all of it.
func (d dialer) each(ctx context.Context, target checkedTarget) (net.Conn, error) {
	deadline, _ := ctx.Deadline()
	lastErr := ErrNoUsableAddress
	for i, addr := range target.addrs {
		attemptCtx, cancel := context.WithTimeout(ctx, time.Until(deadline)/time.Duration(len(target.addrs)-i))
		conn, err := d.base.DialContext(attemptCtx, d.network, net.JoinHostPort(addr.String(), target.port))
		cancel()
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

// dialResult is one family's outcome in a race.
type dialResult struct {
	conn    net.Conn
	err     error
	primary bool
}

// race dials the two address families of one checked target.
type race struct {
	dialer
	results       chan dialResult
	primaryFailed chan struct{}
}

func (r race) primary(ctx context.Context, family checkedTarget) {
	conn, err := r.each(ctx, family)
	if err != nil {
		close(r.primaryFailed)
	}
	r.results <- dialResult{conn: conn, err: err, primary: true}
}

func (r race) fallback(ctx context.Context, family checkedTarget) {
	delay := r.base.FallbackDelay
	if delay == 0 {
		delay = defaultFallbackDelay
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-r.primaryFailed:
	case <-ctx.Done():
		r.results <- dialResult{err: ctx.Err()}
		return
	}
	conn, err := r.each(ctx, family)
	r.results <- dialResult{conn: conn, err: err}
}

// winner is the first connection, or the first family's error when both
// fail. A connection that lands after the winner is closed.
func (r race) winner() (net.Conn, error) {
	var firstErr error
	for remaining := 2; remaining > 0; remaining-- {
		res := <-r.results
		if res.err == nil {
			go closeLate(r.results, remaining-1)
			return res.conn, nil
		}
		if res.primary || firstErr == nil {
			firstErr = res.err
		}
	}
	return nil, firstErr
}

func closeLate(results <-chan dialResult, remaining int) {
	for ; remaining > 0; remaining-- {
		if res := <-results; res.conn != nil {
			_ = res.conn.Close()
		}
	}
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
