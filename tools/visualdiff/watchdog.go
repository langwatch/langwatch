package visualdiff

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// fatalSignatures are log fragments that mean a booting stack is already
// dead, so the run fails the moment one is written, never at the boot timeout.
var fatalSignatures = []string{
	"migrations failed",
	"gave up",
	"_flushSync took too long",
	"Cannot find module",
	"ERR_MODULE_NOT_FOUND",
	"exit status",
	"Unhandled rejection",
	"UnhandledPromiseRejection",
	"unhandledRejection",
	"EADDRINUSE",
}

// fatalLine is the first line of text carrying a fatal signature, or "".
func fatalLine(text string) string {
	for _, line := range strings.Split(ansiEscape.ReplaceAllString(text, ""), "\n") {
		for _, signature := range fatalSignatures {
			if strings.Contains(line, signature) {
				return strings.TrimSpace(line)
			}
		}
	}
	return ""
}

// bootWatch follows one booting stack's haven logs (the combined stack log
// and every lane log in its directory) and its status, and fails a boot that
// writes a fatal line, loses its launcher, or goes quiet for the stall window.
type bootWatch struct {
	slug      string
	stall     time.Duration
	offsets   map[string]int64
	tail      string
	lastMove  time.Time
	lastPhase string
	wasLive   bool
}

// newBootWatch starts a watch with every log's current size as its offset, so
// what an earlier `haven up` of the same slug wrote is never read.
func newBootWatch(slug string, stall time.Duration) *bootWatch {
	watch := &bootWatch{slug: slug, stall: stall, offsets: map[string]int64{}, lastMove: time.Now()}
	for _, path := range watch.logFiles() {
		if info, err := os.Stat(path); err == nil {
			watch.offsets[path] = info.Size()
		}
	}
	return watch
}

func (watch *bootWatch) logFiles() []string {
	main := havenrun.StackLogFile(watch.slug)
	lanes, _ := filepath.Glob(filepath.Join(strings.TrimSuffix(main, ".log"), "*.log"))
	return append([]string{main}, lanes...)
}

// check reads what the logs gained since the last check and judges the boot.
func (watch *bootWatch) check(now time.Time, raw []byte) error {
	for _, path := range watch.logFiles() {
		content, err := readFrom(path, watch.offsets[path])
		if err != nil || content == "" {
			continue
		}
		watch.offsets[path] += int64(len(content))
		watch.lastMove = now
		watch.tail = havenrun.LastLines(ansiEscape.ReplaceAllString(watch.tail+content, ""), 20)
		if line := fatalLine(content); line != "" {
			return fmt.Errorf("stack-broken: %s: fatal line in %s: %s\nlast lines:\n%s", watch.slug, path, line, watch.tail)
		}
	}
	stack, found := stackEntry(raw, watch.slug)
	if phase := fmt.Sprint(stack.Live, stack.Lanes); found && phase != watch.lastPhase {
		watch.lastPhase, watch.lastMove = phase, now
	}
	if raw != nil && watch.wasLive && !stack.Live {
		return fmt.Errorf("stack-broken: %s: haven's launcher exited before the stack was ready\nlast lines:\n%s", watch.slug, watch.tail)
	}
	watch.wasLive = watch.wasLive || stack.Live
	if watch.stall > 0 && now.Sub(watch.lastMove) > watch.stall {
		return fmt.Errorf("stack-broken: %s: no log line and no lane change for %s (logs %s)\nlast lines:\n%s\nprocess tree:\n%s",
			watch.slug, watch.stall, havenrun.StackLogFile(watch.slug), watch.tail, processTree(stack.LauncherPid))
	}
	return nil
}

// watchedStack is the slice of one `haven status --json` stack the watch reads.
type watchedStack struct {
	Slug        string                `json:"slug"`
	Live        bool                  `json:"live"`
	LauncherPid int                   `json:"launcherPid"`
	Lanes       []havenrun.LaneStatus `json:"lanes"`
}

func stackEntry(raw []byte, slug string) (watchedStack, bool) {
	var status struct {
		Stacks []watchedStack `json:"stacks"`
	}
	if json.Unmarshal(raw, &status) != nil {
		return watchedStack{}, false
	}
	for _, stack := range status.Stacks {
		if stack.Slug == slug {
			return stack, true
		}
	}
	return watchedStack{}, false
}

// processTree lists pid and every descendant, found by `pgrep -P`, with ps.
func processTree(pid int) string {
	if pid <= 0 {
		return "(haven reported no launcher pid)"
	}
	pids := []string{strconv.Itoa(pid)}
	for index := 0; index < len(pids) && len(pids) < 200; index++ {
		out, _ := exec.CommandContext(context.Background(), "pgrep", "-P", pids[index]).Output()
		pids = append(pids, strings.Fields(string(out))...)
	}
	out, err := exec.CommandContext(context.Background(), "ps", "-o", "pid,ppid,%cpu,etime,command", "-p", strings.Join(pids, ",")).CombinedOutput()
	if err != nil {
		return fmt.Sprintf("(ps failed: %v)", err)
	}
	return string(out)
}
