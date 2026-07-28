package egress

import (
	"context"
	"io"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// throttleConfig tunes the per-destination soft throttle (ADR-043 rung 1b).
// The throttle is deliberately soft: it slows and flags a suspicious flow
// rather than hard-denying it, so a legitimate large clone degrades instead of
// falling off a false-positive cliff. Thresholds are a step-3 tuning task
// (ADR open question 3) — these defaults are conservative starting points to
// be re-derived from the observed byte/connection distributions.
type throttleConfig struct {
	// connWindow is the sliding window over which new connections to one host
	// are counted.
	connWindow time.Duration
	// maxConnsPerWindow is the burst budget of new connections to a single host
	// within connWindow before tar-pitting begins.
	maxConnsPerWindow int
	// tarpitPerExcessConn is the delay added per connection over budget,
	// capped at maxTarpit. A burst is slowed, not blocked.
	tarpitPerExcessConn time.Duration
	maxTarpit           time.Duration
	// byteBurst is how many bytes may flow to one host at full speed before the
	// sustained rate cap engages (the token bucket's burst size).
	byteBurst int64
	// bytesPerSec is the sustained per-host throughput ceiling once byteBurst
	// is exhausted.
	bytesPerSec float64
}

// defaultThrottleConfig is a placeholder profile. Real numbers come from
// monitoring (ADR-043 open question 3), not from a design guess.
func defaultThrottleConfig() throttleConfig {
	return throttleConfig{
		connWindow:          10 * time.Second,
		maxConnsPerWindow:   20,
		tarpitPerExcessConn: 250 * time.Millisecond,
		maxTarpit:           5 * time.Second,
		byteBurst:           16 << 20, // 16 MiB flows free, then the cap engages
		bytesPerSec:         4 << 20,  // 4 MiB/s sustained per destination
	}
}

// egressThrottle holds per-destination-host flow state for one worker. It is
// owned by a single egressAdapter (already per-worker), so "per destination,
// per worker" is exactly this map keyed by host.
type egressThrottle struct {
	cfg throttleConfig

	mu        sync.Mutex
	connTimes map[string][]time.Time
	limiters  map[string]*rate.Limiter
}

func newEgressThrottle(cfg throttleConfig) *egressThrottle {
	return &egressThrottle{
		cfg:       cfg,
		connTimes: make(map[string][]time.Time),
		limiters:  make(map[string]*rate.Limiter),
	}
}

// admitConnection records a new connection to host and returns the tar-pit
// delay to impose before establishing it (0 when under budget) and whether the
// connection tripped the burst throttle. A burst of new connections to a rare
// host — the exfiltration signature — is slowed here, per host, so other
// destinations for the same worker are untouched.
func (t *egressThrottle) admitConnection(host string) (time.Duration, bool) {
	if t == nil {
		return 0, false
	}
	now := time.Now()
	cutoff := now.Add(-t.cfg.connWindow)

	t.mu.Lock()
	defer t.mu.Unlock()

	times := t.connTimes[host]
	kept := times[:0]
	for _, ts := range times {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	kept = append(kept, now)
	t.connTimes[host] = kept

	excess := len(kept) - t.cfg.maxConnsPerWindow
	if excess <= 0 {
		return 0, false
	}
	delay := time.Duration(excess) * t.cfg.tarpitPerExcessConn
	if delay > t.cfg.maxTarpit {
		delay = t.cfg.maxTarpit
	}
	return delay, true
}

// limiterFor returns the per-host byte-rate limiter, lazily created. Each host
// gets its own bucket so throttling one destination never slows another.
func (t *egressThrottle) limiterFor(host string) *rate.Limiter {
	t.mu.Lock()
	defer t.mu.Unlock()
	lim, ok := t.limiters[host]
	if !ok {
		lim = rate.NewLimiter(rate.Limit(t.cfg.bytesPerSec), int(t.cfg.byteBurst))
		t.limiters[host] = lim
	}
	return lim
}

// throttledCopy streams src→dst, spending byte tokens from the per-host
// limiter. It returns the number of bytes copied and whether the copy was ever
// slowed by the limiter (i.e. the flow was throttled — the byte-volume
// exfiltration signature). Errors terminate the copy the same way io.Copy
// would; the caller treats a closed tunnel as normal completion.
func throttledCopy(ctx context.Context, dst io.Writer, src io.Reader, lim *rate.Limiter) (int64, bool, error) {
	// Chunk to the limiter's burst so WaitN never asks for more than the
	// bucket can ever hold (which would error).
	chunk := lim.Burst()
	if chunk <= 0 || chunk > 64<<10 {
		chunk = 64 << 10
	}
	buf := make([]byte, chunk)
	var total int64
	throttled := false
	for {
		n, rerr := src.Read(buf)
		if n > 0 {
			// Reserve first so we can observe whether tokens were unavailable
			// (a real slow-down) versus freely granted from the burst.
			r := lim.ReserveN(time.Now(), n)
			if d := r.Delay(); d > 0 {
				throttled = true
				timer := time.NewTimer(d)
				select {
				case <-timer.C:
				case <-ctx.Done():
					timer.Stop()
					r.Cancel()
					return total, throttled, ctx.Err()
				}
			}
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return total, throttled, werr
			}
			total += int64(n)
		}
		if rerr != nil {
			if rerr == io.EOF {
				return total, throttled, nil
			}
			return total, throttled, rerr
		}
	}
}
