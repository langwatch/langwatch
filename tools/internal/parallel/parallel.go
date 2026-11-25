// Package parallel runs a function over a slice on every core.
package parallel

import (
	"runtime"
	"sync"
	"sync/atomic"
)

// Map applies fn to every item on all cores and keeps the order.
func Map[T, R any](items []T, fn func(T) R) []R {
	out := make([]R, len(items))
	var next atomic.Int64
	var wg sync.WaitGroup
	for range min(runtime.GOMAXPROCS(0), max(len(items), 1)) {
		wg.Go(func() {
			for k := int(next.Add(1) - 1); k < len(items); k = int(next.Add(1) - 1) {
				out[k] = fn(items[k])
			}
		})
	}
	wg.Wait()
	return out
}
