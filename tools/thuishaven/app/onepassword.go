package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// haven is the only reader of 1Password (ADR-132 amendment 2026-10-23). It reads
// the item in memory for provider detection, for masking, and into the env of
// each process at the moment it starts. No value is written to a file haven keeps.

// onePasswordTimeout bounds one op call; an unlock prompt counts against it.
const onePasswordTimeout = 30 * time.Second

// onePasswordBatch is how long one read answers: the lanes of one launch share
// it, and a later start or restart reads afresh, so a rotated key, or an unlock
// after a failure, reaches the next start.
const onePasswordBatch = 10 * time.Second

// accountPattern is what an account shorthand, sign-in address or id looks like.
var accountPattern = regexp.MustCompile(`^[A-Za-z0-9._@-]+$`)

// errNoItem is op saying the item does not exist: an empty item, not a failure.
var errNoItem = errors.New("the item does not exist")

// opFailures maps op's stderr to fixed words: op's own text is never forwarded.
var opFailures = []struct {
	pattern *regexp.Regexp
	err     error
}{
	{regexp.MustCompile(`(?i)isn't an item|no item matched`), errNoItem},
	{regexp.MustCompile(`(?i)more than one item matches`), errors.New("more than one item has the item's title")},
	{regexp.MustCompile(`(?i)locked`), errors.New("1Password is locked")},
	{regexp.MustCompile(`(?i)not (currently )?signed in|sign in|session|authori[sz]|unauthenticated`), errors.New("op is signed out")},
	{regexp.MustCompile(`(?i)account`), errors.New("op does not know the account")},
}

type onePasswordRead struct {
	fields map[string]string
	err    error
	at     time.Time
}

var onePasswordCache = struct {
	sync.Mutex
	reads map[string]onePasswordRead
}{reads: map[string]onePasswordRead{}}

// forgetOnePassword drops every cached read: after a move, and between tests.
func forgetOnePassword() {
	onePasswordCache.Lock()
	defer onePasswordCache.Unlock()
	onePasswordCache.reads = map[string]onePasswordRead{}
}

// onePasswordFields is the item's fields for account, shared within one launch
// batch. No account is no fields. A failure warns, naming the reason, and
// answers no fields, so a process starts exactly as it would without 1Password.
func onePasswordFields(account string) (map[string]string, error) {
	account = strings.TrimSpace(account)
	if account == "" {
		return nil, nil
	}
	onePasswordCache.Lock()
	defer onePasswordCache.Unlock()
	if read, ok := onePasswordCache.reads[account]; ok && time.Since(read.at) < onePasswordBatch {
		return read.fields, read.err
	}
	fields, err := readOnePasswordItem(account)
	if err != nil {
		fmt.Fprintf(os.Stderr, "haven: 1Password skipped (%v); keys only 1Password holds stay unset\n", err)
	}
	onePasswordCache.reads[account] = onePasswordRead{fields: fields, err: err, at: time.Now()}
	return fields, err
}

// readOnePasswordItem is one `op item get`: the item's fields, an empty map
// when it does not exist, or a fixed reason.
func readOnePasswordItem(account string) (map[string]string, error) {
	raw, err := runOnePassword(account, nil, "item", "get", domain.OnePasswordItem, "--vault", domain.OnePasswordVault, "--format", "json", "--reveal")
	if errors.Is(err, errNoItem) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	fields, err := domain.OnePasswordFields(raw)
	if err != nil {
		return nil, errors.New("op answered something that is not an item")
	}
	return fields, nil
}

// runOnePassword runs op with stdin (nil for none) and answers its stdout.
// A value only ever travels on stdin or stdout, never in args; stdout is never
// printed and stderr is mapped to fixed words (opFailure).
func runOnePassword(account string, stdin []byte, args ...string) ([]byte, error) {
	if !accountPattern.MatchString(account) {
		return nil, fmt.Errorf("%s is not an account shorthand, sign-in address or id", domain.OnePasswordAccountKey)
	}
	ctx, cancel := context.WithTimeout(context.Background(), onePasswordTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "op", append(args, "--account", account)...) //nolint:gosec // fixed binary, args carry no value
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	switch {
	case errors.Is(err, exec.ErrNotFound):
		return nil, errors.New("op not found on PATH")
	case ctx.Err() != nil:
		return nil, fmt.Errorf("op timed out after %s", onePasswordTimeout)
	case err != nil:
		return nil, opFailure(stderr.String(), cmd.ProcessState)
	}
	return stdout.Bytes(), nil
}

// opFailure is the fixed reason for a failed op run.
func opFailure(stderr string, state *os.ProcessState) error {
	for _, failure := range opFailures {
		if failure.pattern.MatchString(stderr) {
			return failure.err
		}
	}
	if state != nil {
		return fmt.Errorf("op failed (exit %d)", state.ExitCode())
	}
	return errors.New("op failed")
}
