package domain

import (
	"crypto/rand"
	"encoding/hex"
)

// A stack needs a few credentials no checkout should have to hand-write: the
// keys that sign sessions and seal stored credentials, the instance-admin key
// and a SCIM token the diff tools authenticate with. haven generates them per
// stack, keeps them beside its other per-stack state so they survive down/up,
// and injects each one only where the developer has not set it (ruling
// 2026-09-30: diff runs must never fail on stack setup).

// StackCredential is one generated credential and the keys whose presence
// means the developer already decided it.
type StackCredential struct {
	Key string
	// YieldsTo names keys that, when set, make this one redundant: every
	// CREDENTIALS_SECRET reader falls back to NEXTAUTH_SECRET, so injecting one
	// beside a developer's NEXTAUTH_SECRET would re-key rows sealed under it.
	YieldsTo []string
}

// StackCredentials are the credentials haven generates for every stack.
// HAVEN_SEED_SCIM_TOKEN is haven's own: the seed stores its digest, the diff
// tools read its value through `haven env --json --reveal`.
var StackCredentials = []StackCredential{
	{Key: "NEXTAUTH_SECRET"},
	{Key: "CREDENTIALS_SECRET", YieldsTo: []string{"NEXTAUTH_SECRET"}},
	{Key: "LANGWATCH_INSTANCE_ADMIN_API_KEY"},
	{Key: "HAVEN_SEED_SCIM_TOKEN"},
}

// FillStackCredentials adds a fresh random value for every credential stored
// lacks, and reports whether it added any (so the caller persists only then).
func FillStackCredentials(stored map[string]string) (map[string]string, bool, error) {
	out := make(map[string]string, len(StackCredentials))
	for key, value := range stored {
		out[key] = value
	}
	added := false
	for _, credential := range StackCredentials {
		if out[credential.Key] != "" {
			continue
		}
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			return nil, false, err
		}
		out[credential.Key] = hex.EncodeToString(raw)
		added = true
	}
	return out, added, nil
}

// StackCredentialsEnv is the KEY=VALUE set to inject: every stored credential
// the developer's resolved environment (.env under the shell) has not set,
// either directly or through a key it yields to.
func StackCredentialsEnv(stored, resolved map[string]string) []string {
	env := make([]string, 0, len(StackCredentials))
	for _, credential := range StackCredentials {
		if stored[credential.Key] == "" || resolved[credential.Key] != "" || anySet(resolved, credential.YieldsTo) {
			continue
		}
		env = append(env, credential.Key+"="+stored[credential.Key])
	}
	return env
}

func anySet(resolved map[string]string, keys []string) bool {
	for _, key := range keys {
		if resolved[key] != "" {
			return true
		}
	}
	return false
}

// ToolPassthroughKeys are keys the diff tools and the interaction simulator
// read that haven does not mint: `haven env` passes them through from the
// stack's own resolution so a tool needs no second copy of them.
var ToolPassthroughKeys = []string{"ANTHROPIC_API_KEY", "JEV_API_KEY", "JEV_BASE_URL"}
