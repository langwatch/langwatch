package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// `haven restart` is one verb with three scopes and one follow-up, rather than
// three commands: bare bounces every supervised child, a positional bounces one,
// and --unhealthy bounces only the children whose port stopped answering — the
// "heal what is broken" pass `haven doctor` was asked for (ADR-064 had retired
// that spelling into `haven status`, which only ever reported). -t then stays
// attached to what the bounced services print next, and means exactly what it
// means on `haven logs`.

// restartTailWait is how long `restart -t` waits before it starts reading. The
// bounce is a SIGTERM the launcher's supervisor notices on its own beat, so
// following instantly would show a second of silence and nothing else.
const restartTailWait = 500 * time.Millisecond

// restartTail is what a `-t` follows: the capture directory, the services that
// were bounced (empty means the whole stack), and where each capture stood
// before the bounce.
type restartTail struct {
	dir      string
	services []string
	offsets  map[string]int64
}

func runRestartCmd(ctx context.Context, d deps, inv invocation) error {
	name := restartName(inv)
	if err := checkRestartScope(inv, name); err != nil {
		return err
	}
	slug, err := d.orch.ResolveSlug(d.params)
	if err != nil {
		return err
	}
	// Read where the captures end BEFORE anything is sent a signal: -t is meant
	// to show the restart, not replay the history that preceded it.
	tail := restartTail{dir: filepath.Join(havenHome(), "logs", slug)}
	tail.offsets = logEndOffsets(tail.dir)

	tailing, follow, err := bounceServices(ctx, d, inv)
	if err != nil {
		return err
	}
	if !follow || !inv.has("--tail") {
		return nil
	}
	// The observability stack is shared machinery with no per-service capture, so
	// its logs come from docker. Same command, same -t, different tap.
	if name == "obs" {
		return d.orch.ObservabilityLogs(ctx, true)
	}
	tail.services = tailing
	return tailAfterRestart(ctx, tail, d.isAgent)
}

// restartName is the service `haven restart` was pointed at — "" for the whole
// stack.
func restartName(inv invocation) string {
	if len(inv.args) > 0 {
		return inv.args[0]
	}
	return ""
}

// checkRestartScope refuses the combinations that name two different things at
// once, rather than letting one of them silently win.
func checkRestartScope(inv invocation, name string) error {
	if !inv.has("--unhealthy") {
		return nil
	}
	if name != "" {
		return fmt.Errorf("haven restart --unhealthy bounces whatever stopped answering — drop the %q argument", name)
	}
	if inv.has("--rebuild") {
		return fmt.Errorf("--rebuild names one container service — `haven restart langy --rebuild`")
	}
	return nil
}

// bounceServices performs the restart the invocation asks for and reports what
// it bounced: the service names for a follow to track (nil meaning "the whole
// stack", which follows everything), and whether anything was bounced at all —
// a healthy stack under --unhealthy must not leave `-t` waiting on output that
// is never coming.
func bounceServices(ctx context.Context, d deps, inv invocation) (tailing []string, bounced bool, err error) {
	if inv.has("--unhealthy") {
		sick, err := d.orch.RestartUnhealthy(ctx, d.params)
		return sick, len(sick) > 0, err
	}
	name := restartName(inv)
	if err := d.orch.Restart(ctx, d.params, name, inv.has("--rebuild")); err != nil {
		return nil, false, err
	}
	if name == "" {
		return nil, true, nil
	}
	return []string{name}, true, nil
}

// tailAfterRestart follows the bounced services' captures from where they stood
// before the bounce.
func tailAfterRestart(ctx context.Context, tail restartTail, plain bool) error {
	// stderr, so `haven restart -t | grep` still sees log lines only.
	fmt.Fprintf(os.Stderr, "tailing %s — ctrl-c to stop (the stack keeps running)\n", tailSubject(tail.services))
	select {
	case <-ctx.Done():
		return nil
	case <-time.After(restartTailWait):
	}
	return followLogs(ctx, tail.dir, tail.services, tail.offsets, time.Time{}, "", plain)
}

// tailSubject names what the follow is about to show, so the notice says
// "tailing nlp" rather than repeating the command back.
func tailSubject(names []string) string {
	switch len(names) {
	case 0:
		return "every service"
	case 1:
		return names[0]
	case 2:
		return names[0] + " and " + names[1]
	}
	return fmt.Sprintf("%s and %d others", names[0], len(names)-1)
}
