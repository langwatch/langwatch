package seedgen

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strings"
)

// Action is one NDJSON line seedgen sends the runner (design §2). Ref names the symbolic ref the
// product mints for this action, if any; the ack returns its id under that name. Refs in Org,
// Project, As and string values of Input are substituted before sending.
type Action struct {
	ID      string          `json:"id"`
	Kind    string          `json:"kind"`
	Ref     string          `json:"ref,omitempty"`
	Org     string          `json:"org,omitempty"`
	Project string          `json:"project,omitempty"`
	As      string          `json:"as,omitempty"`
	Key     string          `json:"key"`
	Input   json.RawMessage `json:"input"`
	At      string          `json:"at,omitempty"`
	// Count is a telemetry chunk's spans, records or points, for the Packer; never on the wire.
	Count int `json:"-"`
}

// Reply is the runner's answer to one action: an ack (OK, Refs) or a refusal (Code, Retryable).
type Reply struct {
	ID        string            `json:"id"`
	OK        bool              `json:"ok"`
	Refs      map[string]string `json:"refs,omitempty"`
	Code      string            `json:"code,omitempty"`
	Retryable bool              `json:"retryable,omitempty"`
	// Existing says the action found what it names instead of creating it (a re-run).
	Existing bool `json:"existing,omitempty"`
}

// WriteAction writes one action as an NDJSON line.
func WriteAction(w io.Writer, action Action) error {
	line, err := json.Marshal(action)
	if err != nil {
		return err
	}
	_, err = w.Write(append(line, '\n'))
	return err
}

// ReadReplies yields each reply line; a malformed line stops the read with its error.
func ReadReplies(r io.Reader, yield func(Reply) bool) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	for scanner.Scan() {
		var reply Reply
		decoder := json.NewDecoder(strings.NewReader(scanner.Text()))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&reply); err != nil {
			return fmt.Errorf("reply %q: %w", scanner.Text(), err)
		}
		if reply.ID == "" || (!reply.OK && reply.Code == "") {
			return fmt.Errorf("reply %q: an ack needs an id; a refusal needs a code", scanner.Text())
		}
		if !yield(reply) {
			return nil
		}
	}
	return scanner.Err()
}

var refPattern = regexp.MustCompile(`^\$[a-z][a-z-]*:\S+$`)

// Refs maps symbolic refs ("$org:startup-1") to the ids the product minted for them.
type Refs map[string]string

// Substitute replaces every known ref in the action; a ref still unknown is an error, since the
// action that mints it has not been acked.
func (refs Refs) Substitute(action Action) (Action, error) {
	var missing []string
	swap := func(value string) string {
		if !refPattern.MatchString(value) {
			return value
		}
		if id, ok := refs[value]; ok {
			return id
		}
		missing = append(missing, value)
		return value
	}
	action.Org, action.Project, action.As = swap(action.Org), swap(action.Project), swap(action.As)
	if len(action.Input) > 0 {
		var input any
		if err := json.Unmarshal(action.Input, &input); err != nil {
			return action, err
		}
		encoded, err := json.Marshal(walkStrings(input, swap))
		if err != nil {
			return action, err
		}
		action.Input = encoded
	}
	if len(missing) > 0 {
		slices.Sort(missing)
		return action, fmt.Errorf("action %s: refs not yet minted: %s", action.ID, strings.Join(slices.Compact(missing), ", "))
	}
	return action, nil
}

func walkStrings(value any, swap func(string) string) any {
	switch typed := value.(type) {
	case string:
		return swap(typed)
	case []any:
		for i := range typed {
			typed[i] = walkStrings(typed[i], swap)
		}
	case map[string]any:
		for key := range typed {
			typed[key] = walkStrings(typed[key], swap)
		}
	}
	return value
}
