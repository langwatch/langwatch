package mcpsim

import (
	"context"
	"fmt"
	"math"
	"slices"
	"sync"
	"time"
)

// run is one scenario's state; every field behind mu.
type run struct {
	mu      sync.Mutex
	st      RunStatus
	samples []float64
	next    int
	cancel  context.CancelFunc
	done    chan struct{}
}

func (r *run) update(f func(*RunStatus)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f(&r.st)
}

// step keeps one step, dropping the oldest past maxSteps.
func (r *run) step(st Step) {
	if st.At.IsZero() {
		st.At = time.Now().UTC()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.st.Steps) >= maxSteps {
		r.st.Steps = append(r.st.Steps[:0], r.st.Steps[1:]...)
		r.st.StepsDropped++
	}
	r.st.Steps = append(r.st.Steps, st)
}

// httpStep fills a step from a plain exchange and keeps it.
func (r *run) httpStep(st Step, x exchange) {
	st.Status, st.LatencyMs = x.status, ms(x.took)
	if x.err != nil {
		st.Error = x.err.Error()
	} else if !st.OK && len(x.body) > 0 && st.Detail == "" {
		st.Error = clip(string(x.body), 300)
	}
	r.attempt(x.status, x.took)
	r.step(st)
}

func (r *run) check(name string, pass bool, detail string) {
	r.update(func(st *RunStatus) { st.Checks = append(st.Checks, Check{Name: name, Pass: pass, Detail: detail}) })
}

// attempt counts one HTTP attempt: its latency, and its status where it had one.
func (r *run) attempt(status int, took time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.samples) < maxSamples {
		r.samples = append(r.samples, ms(took))
	} else {
		r.samples[r.next] = ms(took)
		r.next = (r.next + 1) % maxSamples
	}
	if l := r.st.Load; l != nil {
		l.Requests++
		if status != 0 {
			if l.Answers == nil {
				l.Answers = map[int]int64{}
			}
			l.Answers[status]++
		}
	}
}

// counted changes the load counters of a soak run; other runs have none.
func (r *run) counted(f func(*LoadStats)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.st.Load != nil {
		f(r.st.Load)
	}
}

func (r *run) snapshot(withSteps bool) RunStatus {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.st
	s.Checks = slices.Clone(s.Checks)
	if withSteps {
		s.Steps = slices.Clone(s.Steps)
	} else {
		s.Steps = []Step{}
	}
	if s.Checks == nil {
		s.Checks = []Check{}
	}
	if s.Steps == nil {
		s.Steps = []Step{}
	}
	if s.Load != nil {
		l := *s.Load
		l.Answers = cloneAnswers(l.Answers)
		l.Latency = latencyOf(r.samples)
		s.Load = &l
	}
	if s.FinishedAt == nil {
		s.DurationMs = ms(time.Since(s.StartedAt))
	}
	return s
}

func cloneAnswers(m map[int]int64) map[int]int64 {
	if m == nil {
		return nil
	}
	out := make(map[int]int64, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func (r *run) active() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.st.State == StateRunning || r.st.State == StateWaiting
}

func latencyOf(samples []float64) *Latency {
	if len(samples) == 0 {
		return nil
	}
	sorted := slices.Sorted(slices.Values(samples))
	at := func(q float64) float64 { return sorted[max(0, int(math.Ceil(q*float64(len(sorted))))-1)] }
	return &Latency{Samples: len(sorted), P50: at(0.5), P90: at(0.9), P99: at(0.99), Max: sorted[len(sorted)-1]}
}

// start registers a run and executes body in the background. The run passes
// when body returns nil and every check passed.
func (s *Server) start(st RunStatus, body func(ctx context.Context, rn *run) error) (*run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if running := s.activeCount(); running >= maxRunning {
		return nil, fmt.Errorf("%d runs are already going; stop one first", running)
	}
	s.seq++
	ctx, cancel := context.WithCancel(context.Background())
	st.ID, st.State, st.StartedAt = fmt.Sprintf("run-%d", s.seq), StateRunning, time.Now().UTC()
	st.Steps, st.Checks = []Step{}, []Check{}
	rn := &run{st: st, cancel: cancel, done: make(chan struct{})}
	s.runs = append([]*run{rn}, s.runs...)
	s.prune()
	go func() {
		defer close(rn.done)
		defer cancel()
		rn.finish(ctx, body(ctx, rn))
	}()
	return rn, nil
}

// activeCount is how many runs are going; the caller holds s.mu.
func (s *Server) activeCount() int {
	n := 0
	for _, r := range s.runs {
		if r.active() {
			n++
		}
	}
	return n
}

// finish settles a run's outcome: stopped, passed (every check passed), or failed.
func (r *run) finish(ctx context.Context, err error) {
	r.update(func(st *RunStatus) {
		now := time.Now().UTC()
		st.FinishedAt, st.DurationMs = &now, ms(now.Sub(st.StartedAt))
		passed := err == nil && len(st.Checks) > 0 && !slices.ContainsFunc(st.Checks, func(c Check) bool { return !c.Pass })
		switch {
		case ctx.Err() != nil:
			st.State = StateStopped
		case passed:
			st.State = StatePassed
		default:
			st.State = StateFailed
		}
		if err != nil {
			st.Error = err.Error()
		}
	})
}

// prune drops the oldest finished runs past maxRuns; the caller holds s.mu.
func (s *Server) prune() {
	for len(s.runs) > maxRuns {
		dropped := false
		for j := len(s.runs) - 1; j >= 0; j-- {
			if !s.runs[j].active() {
				s.runs = slices.Delete(s.runs, j, j+1)
				dropped = true
				break
			}
		}
		if !dropped {
			return
		}
	}
}
