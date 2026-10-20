package app

import "sync"

// processSamples is the machine's process list: the monitor tick's shared
// sample while one runs, so its four sweeps fork one `ps` between them rather
// than one each, and a fresh `ps` for anyone else (the hub, a CLI status).
func (o *Orchestrator) processSamples() []ProcessSample {
	if sample := o.cycleSamples.Load(); sample != nil {
		return (*sample)()
	}
	return o.sys.ProcessSamples()
}

// shareCycleSamples starts a tick's shared sample, taken on first use, and
// returns the function that ends it.
func (o *Orchestrator) shareCycleSamples() func() {
	sample := sync.OnceValue(o.sys.ProcessSamples)
	o.cycleSamples.Store(&sample)
	return func() { o.cycleSamples.Store(nil) }
}
