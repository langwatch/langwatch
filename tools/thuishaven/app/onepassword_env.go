package app

import (
	"fmt"
	"os"
	"slices"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

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

// itemEnvFor is withItemEnv for a run in p's checkout, and env alone for a fork PR's.
func itemEnvFor(p UpParams, env []string) []string {
	if p.UntrustedCheckout {
		return env
	}
	return withItemEnv(p.WorktreeDir, env)
}

// itemEnvForStack is withItemEnv for a registered, trusted stack's run, and env
// alone otherwise (a fork PR's stack, or one haven cannot find).
func (o *Orchestrator) itemEnvForStack(slug, dir string, env []string) []string {
	if st, ok := o.stackBySlug(slug); !ok || st.UntrustedCheckout {
		return env
	}
	return withItemEnv(dir, env)
}

// withSecretsAtStart gives a lane that names a checkout its start-time read of
// the item. It is set after the plan file is read, so no value is ever in it.
func withSecretsAtStart(c Child) Child {
	if dir := c.SecretsFrom; dir != "" {
		c.EnvAtStart = func() []string { return onePasswordChildEnv(dir) }
	}
	return c
}

// SecretsExecMarker tells a script `haven secrets exec` already ran it, and
// SecretsExecItemKeys names (never values) the keys it took from the item, so a
// haven run under it keeps them out of every file it writes.
const (
	SecretsExecMarker   = "HAVEN_SECRETS_EXEC"
	SecretsExecItemKeys = "HAVEN_SECRETS_EXEC_ITEM_KEYS"
)

// SecretsExecEnv is the environment `haven secrets exec` runs a command in, in
// the chain's order: this process's own, then .env, then the item's fields, and
// the markers, each key once (a later duplicate is not what getenv reads).
func SecretsExecEnv(worktreeDir string) []string {
	item := onePasswordChildEnv(worktreeDir)
	added := append(dotenvUnderShell(worktreeDir), item...)
	added = append(added, SecretsExecMarker+"=1", SecretsExecItemKeys+"="+strings.Join(envKeys(item), ","))
	replaced := map[string]bool{}
	for _, key := range envKeys(added) {
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

// withoutItemValues drops from env every key a `haven secrets exec` around this
// process took from the item: what haven persists never holds one.
func withoutItemValues(env []string) []string {
	var named string
	for _, kv := range env {
		if key, value, _ := strings.Cut(kv, "="); key == SecretsExecItemKeys {
			named = value
		}
	}
	if named == "" {
		return env
	}
	fromItem := strings.Split(named, ",")
	return slices.DeleteFunc(slices.Clone(env), func(kv string) bool {
		key, _, _ := strings.Cut(kv, "=")
		return slices.Contains(fromItem, key)
	})
}

func envKeys(env []string) []string {
	keys := make([]string, 0, len(env))
	for _, kv := range env {
		key, _, _ := strings.Cut(kv, "=")
		keys = append(keys, key)
	}
	return keys
}

// dotenvUnderShell is every .env assignment the shell leaves unset, in a stable order.
func dotenvUnderShell(repoDir string) []string {
	dotenv := domain.LoadDotenv(repoDir)
	keys := make([]string, 0, len(dotenv))
	for key := range dotenv {
		if os.Getenv(key) == "" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	env := make([]string, 0, len(keys))
	for _, key := range keys {
		env = append(env, key+"="+dotenv[key])
	}
	return env
}

// dotenvCredentialWarning is the line `haven up` prints when .env holds a
// credential, naming the keys and never a value; "" when it holds none.
func dotenvCredentialWarning(repoDir string) string {
	raw, err := os.ReadFile(dotenvPath(repoDir))
	if err != nil {
		return ""
	}
	entries, err := domain.ParseDotenvEntries(string(raw))
	if err != nil {
		return fmt.Sprintf(".env could not be read for credentials: %v", err)
	}
	found := domain.DotenvCredentials(domain.SecretClasses(repoDir), entries)
	if len(found) == 0 {
		return ""
	}
	return fmt.Sprintf(".env holds credentials (%s): keep them in 1Password with `haven secrets move`", strings.Join(entryKeys(found), ", "))
}

func entryKeys(entries []domain.DotenvEntry) []string {
	keys := make([]string, 0, len(entries))
	for _, entry := range entries {
		keys = append(keys, entry.Key)
	}
	return keys
}
