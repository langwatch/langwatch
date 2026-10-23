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

// onePasswordTTL is how long one in-memory read answers, so a long-lived keeper
// picks up a rotated key at a later restart without asking op per lane.
const onePasswordTTL = 5 * time.Minute

// accountPattern is what an account shorthand, sign-in address or id looks like.
var accountPattern = regexp.MustCompile(`^[A-Za-z0-9._@-]+$`)

// notAnItem is how op says the item does not exist: an empty item, not a failure.
var notAnItem = regexp.MustCompile(`(?i)isn't an item|no item matched`)

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

// onePasswordFields is the item's fields for account, read at most once per
// TTL. No account is no fields. A failure warns once, naming the reason, and
// answers no fields, so the stack comes up exactly as it did without 1Password.
func onePasswordFields(account string) (map[string]string, error) {
	account = strings.TrimSpace(account)
	if account == "" {
		return nil, nil
	}
	onePasswordCache.Lock()
	defer onePasswordCache.Unlock()
	if read, ok := onePasswordCache.reads[account]; ok && time.Since(read.at) < onePasswordTTL {
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
// when it does not exist, or an error carrying op's first stderr line.
func readOnePasswordItem(account string) (map[string]string, error) {
	raw, err := runOnePassword(account, nil, "item", "get", domain.OnePasswordItem, "--vault", domain.OnePasswordVault, "--format", "json", "--reveal")
	if err != nil {
		if notAnItem.MatchString(err.Error()) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	fields, err := domain.OnePasswordFields(raw)
	if err != nil {
		return nil, fmt.Errorf("op answered something that is not an item: %w", err)
	}
	return fields, nil
}

// runOnePassword runs op with stdin (nil for none) and answers its stdout.
// A value only ever travels on stdin or stdout, never in args, and stdout is
// never printed; an error carries op's first stderr line.
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
		line, _, _ := strings.Cut(strings.TrimSpace(stderr.String()), "\n")
		if line == "" {
			line = err.Error()
		}
		return nil, errors.New(line)
	}
	return stdout.Bytes(), nil
}

// localDevEnv is the developer's own environment: .env under the shell.
func localDevEnv(repoDir string) map[string]string {
	resolved := domain.LoadDotenv(repoDir)
	for _, kv := range os.Environ() {
		if key, val, ok := strings.Cut(kv, "="); ok && val != "" {
			resolved[key] = val
		}
	}
	return resolved
}

// onePasswordChildEnv is what a process gets from the item when it starts:
// each field the shell and .env leave unset. Nothing when the read failed.
func onePasswordChildEnv(repoDir string) []string {
	local := localDevEnv(repoDir)
	fields, err := onePasswordFields(local[domain.OnePasswordAccountKey])
	if err != nil {
		return nil
	}
	return domain.OnePasswordEnv(fields, local)
}

// withItemEnv puts the item's fields before env for a one-shot run, read now
// and handed to that run only; env wins a clash.
func withItemEnv(repoDir string, env []string) []string {
	return append(onePasswordChildEnv(repoDir), env...)
}

// withSecretsAtStart gives a lane that names a checkout its start-time read of
// the item. It is set after the plan file is read, so no value is ever in it.
func withSecretsAtStart(c Child) Child {
	if dir := c.SecretsFrom; dir != "" {
		c.EnvAtStart = func() []string { return onePasswordChildEnv(dir) }
	}
	return c
}

// SecretsExecMarker tells a script `haven secrets exec` already ran it.
const SecretsExecMarker = "HAVEN_SECRETS_EXEC"

// SecretsExecEnv is the environment `haven secrets exec` runs a command in:
// this process's own plus the item's fields the shell and .env leave unset and
// the marker, each key once (a later duplicate is not what getenv reads).
func SecretsExecEnv(worktreeDir string) []string {
	added := append(onePasswordChildEnv(worktreeDir), SecretsExecMarker+"=1")
	replaced := map[string]bool{}
	for _, kv := range added {
		key, _, _ := strings.Cut(kv, "=")
		replaced[key] = true
	}
	env := make([]string, 0, len(os.Environ())+len(added))
	for _, kv := range os.Environ() {
		if key, _, _ := strings.Cut(kv, "="); !replaced[key] {
			env = append(env, kv)
		}
	}
	return append(env, added...)
}

// dotenvCredentialWarning is the line `haven up` prints when .env holds a
// credential, naming the keys and never a value; "" when it holds none.
func dotenvCredentialWarning(repoDir string) string {
	raw, err := os.ReadFile(dotenvPath(repoDir))
	if err != nil {
		return ""
	}
	found := domain.DotenvCredentials(domain.SecretClasses(repoDir), domain.ParseDotenvEntries(string(raw)))
	if len(found) == 0 {
		return ""
	}
	keys := make([]string, 0, len(found))
	for _, entry := range found {
		keys = append(keys, entry.Key)
	}
	return fmt.Sprintf(".env holds credentials (%s): keep them in 1Password with `haven secrets move`", strings.Join(keys, ", "))
}
