package visualdiff

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// The runner speaks JSON lines on stdout: one object per line, each with a
// "type". Anything it wants a person to read goes to stderr instead, so the
// protocol never has to distinguish log prose from data.
type runnerMessage struct {
	Type string `json:"type"`
	Capture
	Ratio   float64 `json:"ratio"`
	File    string  `json:"file"`
	Message string  `json:"message"`
	Name    string  `json:"name"`
	Millis  int64   `json:"millis"`
}

// RunnerStream is everything one runner invocation reported.
type RunnerStream struct {
	Captures []Capture
	Diffs    []Diff
	Phases   []RunnerPhase
}

// RunnerPhase is how long one side spent in one phase of its capture.
type RunnerPhase struct {
	Side   string
	Name   string
	Millis int64
}

// ParseRunnerStream reads the runner's JSON lines. A malformed line is an
// error rather than a skip: a capture silently dropped reads exactly like a
// screen that matched.
func ParseRunnerStream(reader io.Reader) (RunnerStream, error) {
	return ParseRunnerStreamLive(reader, nil, nil)
}

// ParseRunnerStreamLive reads the runner's JSON lines exactly like
// ParseRunnerStream, but also calls onCapture and onDiff (either may be nil)
// the instant each message is parsed - not once the whole stream has been
// read. Reading reader as the subprocess writes it (a live pipe, not a
// buffer read after the process exits) is what makes that a real streaming
// callback rather than one that just fires the moment the process happens to
// finish.
func ParseRunnerStreamLive(reader io.Reader, onCapture func(Capture), onDiff func(Diff)) (RunnerStream, error) {
	stream := RunnerStream{}
	hooks := runnerStreamHooks{onCapture: onCapture, onDiff: onDiff}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	line := 0
	for scanner.Scan() {
		line++
		text := scanner.Bytes()
		if len(text) == 0 {
			continue
		}
		entry := runnerLine{text: text, line: line}
		if err := entry.applyTo(&stream, hooks); err != nil {
			return stream, err
		}
	}
	if err := scanner.Err(); err != nil {
		return stream, fmt.Errorf("read runner output: %w", err)
	}
	return stream, nil
}

// runnerStreamHooks are the live callbacks ParseRunnerStreamLive fires as it
// reads, grouped so applyRunnerLine takes one argument for them rather than
// two.
type runnerStreamHooks struct {
	onCapture func(Capture)
	onDiff    func(Diff)
}

// runnerLine is one not-yet-parsed line of the runner's output, carrying its
// 1-based line number for the error messages that name it.
type runnerLine struct {
	text []byte
	line int
}

// applyTo parses the line, folds it into stream, and fires the matching
// hook, if any, the instant it is decoded - split out of
// ParseRunnerStreamLive to keep that function's branching within this
// repository's cognitive-complexity limit. The runner's own reported error
// (message.Type == "error") is returned as-is, with no "line N" wrapping: it
// is the runner explicitly telling us something failed, not a parsing
// problem on this side.
func (line runnerLine) applyTo(stream *RunnerStream, hooks runnerStreamHooks) error {
	message := runnerMessage{}
	if err := json.Unmarshal(line.text, &message); err != nil {
		return fmt.Errorf("runner output line %d: %w", line.line, err)
	}
	switch message.Type {
	case "capture":
		stream.Captures = append(stream.Captures, message.Capture)
		if hooks.onCapture != nil {
			hooks.onCapture(message.Capture)
		}
	case "diff":
		diff := Diff{
			Kind: message.Kind, Key: message.Key,
			Index: message.Index, Ratio: message.Ratio, File: message.File,
		}
		stream.Diffs = append(stream.Diffs, diff)
		if hooks.onDiff != nil {
			hooks.onDiff(diff)
		}
	case "error":
		return errors.New("runner: " + message.Message)
	case "phase":
		stream.Phases = append(stream.Phases, RunnerPhase{Side: message.Side, Name: message.Name, Millis: message.Millis})
	case "done", "ready", "log":
	default:
		return fmt.Errorf("runner output line %d: unknown message type %q", line.line, message.Type)
	}
	return nil
}

// RunnerPlan is the job Go hands the runner. It is written to a file rather
// than passed as flags: the flow list is the whole configuration, and a
// command line is the wrong place for it.
type RunnerPlan struct {
	Viewport   Viewport     `json:"viewport"`
	Settle     Settle       `json:"settle"`
	Sides      []RunnerSide `json:"sides"`
	OutDir     string       `json:"outDir"`
	Slug       string       `json:"slug"`
	Routes     []string     `json:"routes"`
	Flows      []Flow       `json:"flows"`
	Credential SeedIdentity `json:"credential"`
	// FailFast stops the runner once the candidate's first routes show its
	// shell does not render (runner/src/shell.ts).
	FailFast bool `json:"failFast,omitempty"`
	// FrozenTime is the Date.now() both sides' pages see, so relative times
	// and "today" render alike; Fixtures fill a route's {name} placeholders.
	FrozenTime int64             `json:"frozenTime,omitempty"`
	Fixtures   map[string]string `json:"fixtures,omitempty"`
	// Concurrency is how many pages each side captures on at once.
	Concurrency Concurrency `json:"concurrency,omitempty"`
	// Edition and Stacks are read back by recapture, which sets the same
	// edition on the same stacks before it renders again.
	Edition Edition        `json:"edition,omitempty"`
	Stacks  []EditionStack `json:"stacks,omitempty"`
}

// RunnerSide is one stack the runner drives. Replay names a cached
// baseline's captures the runner reads instead of rendering this side.
type RunnerSide struct {
	Name    string `json:"name"`
	BaseURL string `json:"baseUrl"`
	Replay  string `json:"replay,omitempty"`
	// Pending names the file this side's address arrives in once its stack
	// is ready (PendingBaseFile); the runner starts the other side meanwhile.
	Pending string `json:"pending,omitempty"`
	// Fixtures are the ids this side's seed generated; they fill a route's
	// {name} over the plan's static fixtures.
	Fixtures map[string]string `json:"fixtures,omitempty"`
	// StaticDir holds this side's built UI, which the runner serves instead
	// of the dev server's modules; empty keeps the side on its dev server.
	StaticDir string `json:"staticDir,omitempty"`
}
