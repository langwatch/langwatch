package mcpsim

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"sync"
	"time"
)

// soak runs N clients for a duration, each looping tools/list (and the tool
// when one was named) about once a second, re-initializing as needed.
func (sc scenario) soak(ctx context.Context) error {
	p := sc.p
	sc.rn.update(func(st *RunStatus) { st.Load = &LoadStats{Clients: p.Clients} })
	ctx, cancel := context.WithTimeout(ctx, p.duration)
	defer cancel()
	var wg sync.WaitGroup
	for i := range p.Clients {
		wg.Go(func() { sc.soakClient(ctx, p.transports[i%len(p.transports)]) })
	}
	wg.Wait()
	l := sc.rn.snapshot(false).Load
	sc.rn.check(fmt.Sprintf("%d clients for %s with no failed request", p.Clients, p.duration), l.Errors == 0 && l.Sessions > 0,
		fmt.Sprintf("%d requests, %d sessions, %d errors, %d re-initialized, %d refreshed, %d retried",
			l.Requests, l.Sessions, l.Errors, l.Reinitialized, l.Refreshed, l.Retried))
	return nil
}

// soakClient is one client of a soak, until ctx ends.
func (sc scenario) soakClient(ctx context.Context, path string) {
	c := sc.client(path)
	c.isQuiet = true
	defer func() { _ = c.end(context.WithoutCancel(ctx)) }()
	// Spread the first initializes over a second, as clients starting up would.
	if !sc.s.sleep(ctx, jitter(time.Second)) {
		return
	}
	for n := 0; ctx.Err() == nil; n++ {
		if c.sessionID == "" && c.initialize(ctx) != nil {
			sc.s.sleep(ctx, time.Second)
			continue
		}
		if sc.p.Tool != "" && n%5 == 4 {
			_, _ = c.call(ctx, "tools/call", map[string]any{"name": sc.p.tool, "arguments": orEmpty(sc.p.ToolArgs)})
		} else {
			_, _ = c.call(ctx, kindToolsList, map[string]any{})
		}
		sc.s.sleep(ctx, 900*time.Millisecond+jitter(200*time.Millisecond))
	}
}

// jitter is a random duration below d.
func jitter(d time.Duration) time.Duration {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return time.Duration(binary.LittleEndian.Uint64(b[:]) % uint64(d))
}
