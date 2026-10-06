package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"
)

// The base is a pinned main commit, so its baseline is reused run after run.
// The pin moves only once main has changed PinMoveLines lines since it, or on
// -rebase-main. It lives in the baseline cache, which gc never collects.
const (
	MainPinFile  = "main-pin.json"
	PinMoveLines = 2000
)

// MainPin is the recorded pin: the ref it follows and the commit it holds.
type MainPin struct {
	Ref      string    `json:"ref"`
	Commit   string    `json:"commit"`
	PinnedAt time.Time `json:"pinnedAt"`
}

// PinDecision is the commit a run renders as its base, and why.
type PinDecision struct {
	Commit string
	Moved  bool
	Why    string
}

// pinRequest is one decision's inputs.
type pinRequest struct {
	run    runner
	root   string
	ref    string
	rebase bool
}

func pinPath(root string) string {
	return filepath.Join(root, ".visualdiff", BaselinesDir, MainPinFile)
}

// ReadMainPin reads the recorded pin, or the zero pin.
func ReadMainPin(root string) MainPin {
	var pin MainPin
	if content, err := os.ReadFile(pinPath(root)); err == nil { // #nosec G304 -- the tool's own baseline cache.
		_ = json.Unmarshal(content, &pin)
	}
	return pin
}

// WriteMainPin records a pin.
func WriteMainPin(root string, pin MainPin) error {
	if err := os.MkdirAll(filepath.Dir(pinPath(root)), 0o750); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(pin, "", " ")
	if err != nil {
		return err
	}
	return os.WriteFile(pinPath(root), encoded, 0o600)
}

// DecidePin keeps the recorded pin unless it is missing, follows another ref,
// is gone from the repository, is asked to move, or main has moved far enough.
func DecidePin(ctx context.Context, request pinRequest, pin MainPin) (PinDecision, error) {
	head, err := resolveCommit(ctx, gitRef{run: request.run, root: request.root, ref: request.ref})
	if err != nil {
		return PinDecision{}, err
	}
	move := func(why string) (PinDecision, error) { return PinDecision{Commit: head, Moved: true, Why: why}, nil }
	switch {
	case pin.Commit == "":
		return move("no pin yet")
	case request.rebase:
		return move("-rebase-main")
	case pin.Ref != request.ref:
		return move(fmt.Sprintf("the pin followed %s, not %s", pin.Ref, request.ref))
	case pin.Commit == head:
		return PinDecision{Commit: pin.Commit, Why: request.ref + " has not moved since the pin"}, nil
	}
	lines, err := changedLines(ctx, request, revRange{from: pin.Commit, to: head})
	if err != nil {
		return move("the pinned commit is gone")
	}
	if lines >= PinMoveLines {
		return move(fmt.Sprintf("%s changed %d lines since the pin, %d or more", request.ref, lines, PinMoveLines))
	}
	return PinDecision{Commit: pin.Commit, Why: fmt.Sprintf("%s changed %d lines since the pin, under %d", request.ref, lines, PinMoveLines)}, nil
}

// revRange is two commits a diff runs between.
type revRange struct {
	from, to string
}

// changedLines is `git diff --shortstat from to`'s insertions plus deletions.
func changedLines(ctx context.Context, request pinRequest, revs revRange) (int, error) {
	var out bytes.Buffer
	spec := commandSpec{name: "git", args: []string{"diff", "--shortstat", revs.from, revs.to}, dir: request.root}
	if err := request.run(ctx, spec, &out); err != nil {
		return 0, err
	}
	return ShortstatLines(out.String()), nil
}

var shortstatCount = regexp.MustCompile(`(\d+) (insertion|deletion)`)

// ShortstatLines sums the insertions and deletions of a --shortstat line.
func ShortstatLines(shortstat string) int {
	total := 0
	for _, match := range shortstatCount.FindAllStringSubmatch(shortstat, -1) {
		count, _ := strconv.Atoi(match[1])
		total += count
	}
	return total
}

// pinMain decides the base commit, says which and why, and records a moved
// pin (not on a dry run). A ref that cannot be resolved leaves it unpinned.
func pinMain(ctx context.Context, request Request, stderr io.Writer) string {
	options := request.Options
	pin := ReadMainPin(options.Root)
	decision, err := DecidePin(ctx, pinRequest{run: request.Deps.Run, root: options.Root, ref: options.BaseRef, rebase: options.RebaseMain}, pin)
	if err != nil {
		fmt.Fprintf(stderr, "main: not pinned, the base is %s as it is now: %v\n", options.BaseRef, err)
		return options.BaseRef
	}
	verb := "pinned at"
	switch {
	case decision.Moved && options.DryRun:
		verb = "pin would move to"
	case decision.Moved:
		verb = "pin moved to"
	}
	fmt.Fprintf(stderr, "main: %s %s %s (%s)\n", options.BaseRef, verb, shortCommit(decision.Commit), decision.Why)
	if decision.Moved && !options.DryRun {
		if err := WriteMainPin(options.Root, MainPin{Ref: options.BaseRef, Commit: decision.Commit, PinnedAt: request.Deps.Now().UTC()}); err != nil {
			fmt.Fprintf(stderr, "main: could not record the pin: %v\n", err)
		}
	}
	return decision.Commit
}

func shortCommit(commit string) string {
	if len(commit) > 12 {
		return commit[:12]
	}
	return commit
}
