// Package bootstrap is the local admin of dynamic-only mode (ADR-190): a
// password generated at every server start, written only to an in-pod tmpfs
// and valid only from loopback. In-pod helpers (the access sidecar, the backup
// runner) read it through Read or Client, once per connection.
package bootstrap

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	// User is the only file-defined user with a password in dynamic-only mode.
	User = "local_admin"
	// DefaultDir is where the image writes the password; mount a tmpfs there.
	DefaultDir = "/run/clickhouse-access"
	// PasswordFile is the file under the directory holding the password.
	PasswordFile = "password"
	// UsersFileName is the users.d file defining User.
	UsersFileName = "access-bootstrap.yaml"
	// passwordBytes of randomness, hex-encoded.
	passwordBytes = 32
)

// Credential logs in as the local admin.
type Credential struct {
	User     string
	Password string
}

// Generate writes a fresh random password to dir/password and returns it.
// The file is replaced atomically, mode 0440: readable by uid and group 101
// (the server and its sidecars), never by anyone else.
func Generate(dir string) (Credential, error) {
	raw := make([]byte, passwordBytes)
	if _, err := rand.Read(raw); err != nil {
		return Credential{}, err
	}
	c := Credential{User: User, Password: hex.EncodeToString(raw)}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return Credential{}, err
	}
	tmp, err := os.CreateTemp(dir, ".password-*")
	if err != nil {
		return Credential{}, err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o440); err != nil {
		tmp.Close()
		return Credential{}, err
	}
	if _, err := tmp.WriteString(c.Password + "\n"); err != nil {
		tmp.Close()
		return Credential{}, err
	}
	if err := tmp.Close(); err != nil {
		return Credential{}, err
	}
	if err := os.Rename(tmp.Name(), filepath.Join(dir, PasswordFile)); err != nil {
		return Credential{}, err
	}
	return c, nil
}

// Read returns the current credential. It changes at every server start, so
// read it for each connection rather than once.
func Read(dir string) (Credential, error) {
	data, err := os.ReadFile(filepath.Join(dir, PasswordFile))
	if err != nil {
		return Credential{}, err
	}
	pw := strings.TrimSpace(string(data))
	if len(pw) < 2*passwordBytes {
		return Credential{}, fmt.Errorf("%s: not a generated password", filepath.Join(dir, PasswordFile))
	}
	return Credential{User: User, Password: pw}, nil
}

// Remove deletes the password, if any: a server out of dynamic-only mode
// leaves no stale credential behind. It looks before it deletes: on a
// read-only root, unlinking a missing file fails EROFS, not ENOENT.
func Remove(dir string) error {
	path := filepath.Join(dir, PasswordFile)
	if _, err := os.Lstat(path); errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	err := os.Remove(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// UsersYAML is the users.d document for the local admin: its password hash,
// loopback only, full rights including access management.
func UsersYAML(c Credential) ([]byte, error) {
	sum := sha256.Sum256([]byte(c.Password))
	return yaml.Marshal(map[string]any{
		"users": map[string]any{
			c.User: map[string]any{
				"password_sha256_hex": hex.EncodeToString(sum[:]),
				"networks": map[string]any{
					"@replace": "replace",
					"ip":       LoopbackNetworks,
				},
				"profile":                  "default",
				"quota":                    "default",
				"access_management":        1,
				"named_collection_control": 1,
				"show_named_collections":   1,
			},
		},
	})
}

// LoopbackNetworks are the only addresses User may log in from.
var LoopbackNetworks = []string{"127.0.0.1", "::1"}
