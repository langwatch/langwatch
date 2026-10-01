package visualdiff

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// The gateway's three credentials are checked all-or-none, and each must be at
// least MinGatewaySecretLength characters. A developer's own .env commonly
// carries short placeholders — the check then refuses the api's boot, correctly,
// and a run that only wanted to photograph screens dies with it.
//
// visualdiff substitutes rather than refuses, but only into the COPIED .env of a
// throwaway worktree whose databases haven creates, migrates and seeds from
// scratch. The developer's own .env is never written, and their own virtual keys
// are never touched: regenerating LW_VIRTUAL_KEY_PEPPER would invalidate every
// virtual key the pepper protects, which is not a trade a screenshot tool may
// make on someone's behalf.
//
// Both stacks derive from the same seed, so base and candidate always agree —
// a substituted secret can never be the reason two screens differ.
//
// The substitution exists so a MISSING credential does not stop the diff. It
// must never be extended to a credential that is present and WRONG: that is a
// real refusal, and the tool's job is to let it reach the report rather than
// paper over it. A value long enough to pass the check is left exactly as the
// developer wrote it, correct or not.
//
// Every substitution is announced, once per stack, on the run log. That line is
// part of the feature: a tool that manufactures a secret to boot itself is
// precisely how a genuine "this branch will not boot without gateway secrets"
// regression becomes invisible, which is the class of bug visualdiff exists to
// catch.
const MinGatewaySecretLength = 32

// GatewaySecretKeys are substituted together or not at all, mirroring the
// all-or-none check they have to satisfy.
var GatewaySecretKeys = []string{
	"LW_GATEWAY_INTERNAL_SECRET",
	"LW_GATEWAY_JWT_SECRET",
	"LW_VIRTUAL_KEY_PEPPER",
}

// derivedSecret is a deterministic 64-character value for one key under one
// seed. Deterministic on purpose: the two stacks of a run must agree, and a
// re-run of the same run id reproduces what it used.
func derivedSecret(seed, key string) string {
	sum := sha256.Sum256([]byte(seed + "\x00" + key))
	return hex.EncodeToString(sum[:])
}

// usableSecret reports whether a value already satisfies the gateway's check,
// so a developer who has configured real secrets keeps them.
func usableSecret(value string) bool {
	return len(strings.TrimSpace(value)) >= MinGatewaySecretLength
}

// readEnvValue returns the last assignment of key in a .env body, unquoted.
func readEnvValue(body, key string) string {
	value := ""
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") || !strings.HasPrefix(trimmed, key+"=") {
			continue
		}
		value = strings.Trim(strings.TrimPrefix(trimmed, key+"="), `"'`)
	}
	return value
}

// EnsureGatewaySecrets gives one worktree's .env a usable gateway trio, and
// reports the keys it had to substitute — empty when the developer's own values
// already pass. Writes nothing when there is nothing to fix, and never touches a
// key that is already long enough.
func EnsureGatewaySecrets(dir, seed string) ([]string, error) {
	path := filepath.Join(dir, ".env")
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	body := string(raw)
	substituted := []string{}
	for _, key := range GatewaySecretKeys {
		if !usableSecret(readEnvValue(body, key)) {
			substituted = append(substituted, key)
		}
	}
	if len(substituted) == 0 {
		return nil, nil
	}
	sort.Strings(substituted)

	// Comment the unusable assignments out rather than deleting them, so the
	// worktree still shows what the developer's own file said.
	lines := strings.Split(body, "\n")
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		for _, key := range substituted {
			if strings.HasPrefix(trimmed, key+"=") {
				lines[index] = "# visualdiff replaced this placeholder: " + line
			}
		}
	}

	appended := []string{"", "# Added by visualdiff: the gateway's all-or-none check needs " +
		fmt.Sprintf("%d+ characters, and this worktree's .env carried none usable.", MinGatewaySecretLength),
		"# Throwaway values for a throwaway stack; the developer's own .env is untouched."}
	for _, key := range substituted {
		appended = append(appended, key+"="+derivedSecret(seed, key))
	}
	updated := strings.Join(lines, "\n") + strings.Join(appended, "\n") + "\n"
	if err := os.WriteFile(path, []byte(updated), 0o600); err != nil {
		return nil, fmt.Errorf("write %s: %w", path, err)
	}
	return substituted, nil
}
