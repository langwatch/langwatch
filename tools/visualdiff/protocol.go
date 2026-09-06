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
}

// RunnerStream is everything one runner invocation reported.
type RunnerStream struct {
	Captures []Capture
	Diffs    []Diff
}

// ParseRunnerStream reads the runner's JSON lines. A malformed line is an
// error rather than a skip: a capture silently dropped reads exactly like a
// screen that matched.
func ParseRunnerStream(reader io.Reader) (RunnerStream, error) {
	stream := RunnerStream{}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	line := 0
	for scanner.Scan() {
		line++
		text := scanner.Bytes()
		if len(text) == 0 {
			continue
		}
		message := runnerMessage{}
		if err := json.Unmarshal(text, &message); err != nil {
			return stream, fmt.Errorf("runner output line %d: %w", line, err)
		}
		switch message.Type {
		case "capture":
			stream.Captures = append(stream.Captures, message.Capture)
		case "diff":
			stream.Diffs = append(stream.Diffs, Diff{
				Kind: message.Kind, Key: message.Key,
				Index: message.Index, Ratio: message.Ratio, File: message.File,
			})
		case "error":
			return stream, errors.New("runner: " + message.Message)
		case "done", "ready", "log":
		default:
			return stream, fmt.Errorf("runner output line %d: unknown message type %q", line, message.Type)
		}
	}
	if err := scanner.Err(); err != nil {
		return stream, fmt.Errorf("read runner output: %w", err)
	}
	return stream, nil
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
}

// RunnerSide is one stack the runner drives.
type RunnerSide struct {
	Name    string `json:"name"`
	BaseURL string `json:"baseUrl"`
}
