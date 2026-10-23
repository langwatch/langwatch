package app

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// SecretsMoveParams is one `haven secrets move`: the checkout, the account
// (empty reads LANGWATCH_OP_ACCOUNT from the shell or .env) and whether to write.
type SecretsMoveParams struct {
	WorktreeDir string
	Account     string
	Apply       bool
}

func dotenvPath(repoDir string) string { return filepath.Join(repoDir, ".env") }

// SecretsMove moves every credential line of .env into the 1Password item:
// a dry run naming the keys unless Apply. Applied, the values reach op on
// stdin only, the item is read back, and only then do the lines leave .env.
func (o *Orchestrator) SecretsMove(p SecretsMoveParams, out io.Writer) error {
	path := dotenvPath(p.WorktreeDir)
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		_, _ = fmt.Fprintln(out, "no .env in this checkout: nothing to move")
		return nil
	}
	if err != nil {
		return err
	}
	text := string(raw)
	values := movableCredentials(p.WorktreeDir, text)
	if len(values) == 0 {
		_, _ = fmt.Fprintln(out, ".env holds no credential: nothing to move")
		return nil
	}
	_, _ = fmt.Fprintf(out, "to move into 1Password (%s/%s) and delete from .env:\n", domain.OnePasswordVault, domain.OnePasswordItem)
	for _, key := range slices.Sorted(maps.Keys(values)) {
		_, _ = fmt.Fprintf(out, "  %s\n", key)
	}
	if !p.Apply {
		_, _ = fmt.Fprintln(out, "dry run: nothing written. Apply with `haven secrets move --apply --account <shorthand>` (`op account list` names it).")
		return nil
	}
	account := strings.TrimSpace(p.Account)
	if account == "" {
		account = localDevEnv(p.WorktreeDir)[domain.OnePasswordAccountKey]
	}
	if account == "" {
		return errors.New("name the 1Password account: haven secrets move --apply --account <shorthand> (`op account list` names it)")
	}
	return applyMove(applyMoveParams{path: path, text: text, account: account, values: values}, out)
}

// movableCredentials is key to value for every credential line of the .env text.
func movableCredentials(repoDir, text string) map[string]string {
	values := map[string]string{}
	for _, entry := range domain.DotenvCredentials(domain.SecretClasses(repoDir), domain.ParseDotenvEntries(text)) {
		values[entry.Key] = entry.Value
	}
	return values
}

type applyMoveParams struct {
	path, text, account string
	values              map[string]string
}

// applyMove writes the item, reads it back, then drops the moved lines from .env.
func applyMove(p applyMoveParams, out io.Writer) error {
	if err := writeOnePasswordItem(p.account, p.values); err != nil {
		return fmt.Errorf("1Password was not updated, .env is untouched: %w", err)
	}
	if err := verifyOnePasswordItem(p.account, p.values); err != nil {
		return fmt.Errorf("1Password was not updated, .env is untouched: %w", err)
	}
	moved := make(map[string]bool, len(p.values))
	for key := range p.values {
		moved[key] = true
	}
	if err := writeFileInPlace(p.path, []byte(domain.RewriteDotenv(p.text, moved, p.account))); err != nil {
		return fmt.Errorf("the item holds every value, but .env could not be rewritten: %w", err)
	}
	forgetOnePassword()
	_, _ = fmt.Fprintf(out, "moved %d keys; .env sets %s=%q. Restart the stack: haven down && haven up\n", len(p.values), domain.OnePasswordAccountKey, p.account)
	return nil
}

// writeOnePasswordItem creates the item, or edits it keeping its other fields.
func writeOnePasswordItem(account string, values map[string]string) error {
	where := []string{domain.OnePasswordItem, "--vault", domain.OnePasswordVault}
	current, err := runOnePassword(account, nil, append([]string{"item", "get"}, append(where, "--format", "json", "--reveal")...)...)
	if err != nil && !notAnItem.MatchString(err.Error()) {
		return err
	}
	if err != nil {
		template, err := domain.NewOnePasswordItem(values)
		if err != nil {
			return err
		}
		_, err = runOnePassword(account, template, "item", "create", "-", "--vault", domain.OnePasswordVault)
		return err
	}
	template, err := domain.MergeOnePasswordItem(current, values)
	if err != nil {
		return err
	}
	_, err = runOnePassword(account, template, append([]string{"item", "edit"}, where...)...)
	return err
}

// verifyOnePasswordItem reads the item afresh and refuses unless every value is there.
func verifyOnePasswordItem(account string, values map[string]string) error {
	forgetOnePassword()
	fields, err := readOnePasswordItem(account)
	if err != nil {
		return fmt.Errorf("reading the item back: %w", err)
	}
	var missing []string
	for key, value := range values {
		if fields[key] != value {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("the item did not read back %s", strings.Join(missing, ", "))
	}
	return nil
}

// writeFileInPlace replaces path through a sibling and a rename, keeping its mode.
func writeFileInPlace(path string, data []byte) error {
	mode := os.FileMode(0o600)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".env.tmp-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(mode); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
