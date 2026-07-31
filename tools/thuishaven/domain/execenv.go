package domain

import (
	"sort"
	"strings"
)

// ExecEnv layers dotenv underneath base and returns the result: a key already
// present in base keeps its value, and dotenv supplies only the rest.
//
// That precedence is the one haven already documents for its own knobs — an
// exported variable wins for a single run — so `haven exec -- <cmd>` resolves a
// variable the same way the surrounding command does. The layering is what makes
// the command worth having: NODE_EXTRA_CA_CERTS has to be in the environment
// before the process starts, because node reads it once at bootstrap, and no
// amount of dotenv loading from inside the process can put it there.
func ExecEnv(base []string, dotenv map[string]string) []string {
	env := make([]string, 0, len(base)+len(dotenv))
	env = append(env, base...)

	held := make(map[string]struct{}, len(base))
	for _, entry := range base {
		if key, _, ok := strings.Cut(entry, "="); ok {
			held[key] = struct{}{}
		}
	}

	// Sorted so the same stack always produces the same environment; map order
	// would otherwise make a child's env vary run to run for no reason.
	keys := make([]string, 0, len(dotenv))
	for key := range dotenv {
		if _, taken := held[key]; !taken {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		env = append(env, key+"="+dotenv[key])
	}
	return env
}
