package visualdiff

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// monolithAppDotenv is the file a monolith base's app reloads with override
// after haven's overlay, so only a value written there reaches it.
var monolithAppDotenv = filepath.Join("platform", "app", ".env")

// MonolithDotenvPins are what a monolith base needs for its screens to match
// the candidate's: its background workers inside the app process, as its own
// `pnpm dev` asks and haven's dev:app lane does not, and every seeded admin as
// a platform operator, since that ref seeds a retired email the overlay omits.
func MonolithDotenvPins() []string {
	operators := append([]string{SeededEmail}, RetiredSeededEmails...)
	return []string{"WORKERS_IN_PROCESS=1", "ADMIN_EMAILS=" + strings.Join(operators, ",")}
}

// PinMonolithDotenv appends MonolithDotenvPins to dir's app .env, creating it
// when the developer has none. A worktree without the monolith's app directory
// is left alone. The root .env is never pinned: haven refuses WORKERS_IN_PROCESS there.
func PinMonolithDotenv(dir string) error {
	info, err := os.Stat(filepath.Join(dir, filepath.Dir(monolithAppDotenv)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil || !info.IsDir() {
		return err
	}
	path := filepath.Join(dir, monolithAppDotenv)
	data, err := os.ReadFile(path) // #nosec G304 -- path is the app .env inside a worktree this run created.
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	pinned := strings.TrimRight(string(data), "\n") +
		"\n# pinned by visualdiff for the monolith base\n" + strings.Join(MonolithDotenvPins(), "\n") + "\n"
	return os.WriteFile(path, []byte(pinned), 0o600) // #nosec G703 -- the same worktree-internal path read above.
}
