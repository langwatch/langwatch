package app

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// stackLicenceKeyPath is the stack's licence signing key: haven's own state,
// mode 0600, never printed; only the seedgen child is handed it.
func (o *Orchestrator) stackLicenceKeyPath(slug string) string {
	return filepath.Join(o.cfg.Home, "licence", slug, "private.pem")
}

// stackLicenceKey reads the stack's licence signing key, minting it on first
// use. O_EXCL makes a concurrent first use read the winner's key.
func (o *Orchestrator) stackLicenceKey(slug string) ([]byte, error) {
	path := o.stackLicenceKeyPath(slug)
	if key, err := os.ReadFile(path); !errors.Is(err, fs.ErrNotExist) {
		return key, err
	}
	key, err := domain.MintLicenceKey()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, fs.ErrExist) {
		return os.ReadFile(path)
	}
	if err != nil {
		return nil, err
	}
	if _, err := f.Write(key); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return nil, err
	}
	return key, f.Close()
}

// licenceEnv is the stack's licence key half to inject: the public key for
// every process, the private key (withPrivate) for the seedgen child only.
// A failure is logged and injects nothing, as credentialEnv does.
func (o *Orchestrator) licenceEnv(slug string, resolved map[string]string, withPrivate bool) []string {
	if slug == "" || o.cfg.Home == "" {
		return nil
	}
	key, err := o.stackLicenceKey(slug)
	if err == nil && !withPrivate {
		key, err = domain.LicencePublicKey(key)
	}
	if err != nil {
		o.logger().Warn("could not read or mint the stack's licence key", zap.String("slug", slug), zap.Error(err))
		return nil
	}
	if withPrivate {
		return domain.StackLicenceEnv(domain.LicencePrivateKeyVar, key, resolved)
	}
	return domain.StackLicenceEnv(domain.LicencePublicKeyVar, key, resolved)
}
