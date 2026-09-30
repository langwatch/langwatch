package app

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// stackCredentialsPath is where one stack's generated credentials live: haven's
// own per-stack state, beside its idp and mail data, never the checkout.
func (o *Orchestrator) stackCredentialsPath(slug string) string {
	return filepath.Join(o.cfg.Home, "credentials", slug+".json")
}

// stackCredentials reads this stack's generated credentials, minting and
// persisting (0600) any that are missing, so a value survives down/up and is
// only rotated by `haven destroy`.
func (o *Orchestrator) stackCredentials(slug string) (map[string]string, error) {
	path := o.stackCredentialsPath(slug)
	stored := map[string]string{}
	raw, err := os.ReadFile(path)
	switch {
	case err == nil:
		if err := json.Unmarshal(raw, &stored); err != nil {
			return nil, err
		}
	case !errors.Is(err, fs.ErrNotExist):
		return nil, err
	}
	filled, added, err := domain.FillStackCredentials(stored)
	if err != nil || !added {
		return filled, err
	}
	encoded, err := json.MarshalIndent(filled, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	return filled, os.WriteFile(path, encoded, 0o600)
}

// credentialEnv is the generated credentials this stack's processes are
// started with: those the developer's .env and shell leave unset. A failure
// is logged and injects nothing, so the stack still comes up as it did before.
func (o *Orchestrator) credentialEnv(slug, worktreeDir string) []string {
	if slug == "" || o.cfg.Home == "" {
		return nil
	}
	stored, err := o.stackCredentials(slug)
	if err != nil {
		o.logger().Warn("could not read or write the stack's generated credentials",
			zap.String("slug", slug), zap.Error(err))
		return nil
	}
	return domain.StackCredentialsEnv(stored, resolvedDevEnv(worktreeDir))
}

// removeStackCredentials forgets a destroyed stack's credentials, with the
// data they sealed.
func (o *Orchestrator) removeStackCredentials(slug string) {
	if o.cfg.Home != "" {
		_ = os.Remove(o.stackCredentialsPath(slug))
	}
}

// toolEnv is what `haven env` hands a shell or a diff tool: the overlay, the
// generated credentials, and the model keys the tools need, taken from where
// the stack itself resolves them (.env under the shell).
func (o *Orchestrator) toolEnv(st domain.Stack) []string {
	env := append(st.OverlayEnv(), o.credentialEnv(st.Slug, st.WorktreeDir)...)
	resolved := resolvedDevEnv(st.WorktreeDir)
	for _, key := range domain.ToolPassthroughKeys {
		if resolved[key] != "" {
			env = append(env, key+"="+resolved[key])
		}
	}
	return env
}
