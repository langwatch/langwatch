package access

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	// MinPasswordLength refuses a guessable password; generated ones are longer.
	MinPasswordLength = 16
	// MaxPasswordFiles stops a directory mounted by mistake (all of /run/secrets,
	// say) from turning every file in it into a password.
	MaxPasswordFiles = 8
	validUntilSuffix = ".valid_until"
)

// Password is one valid password of a rolling user, as ClickHouse stores it.
type Password struct {
	File       string     // file name in the directory
	SHA256Hex  string     // hex SHA-256 of the password; the plaintext is never kept
	ValidUntil *time.Time // nil: valid until its file is removed
}

// ReadPasswordDir reads a rolling user's directory. Every regular, non-hidden
// file is a password; `<name>.valid_until` holds an RFC 3339 instant ending
// `<name>`. Hidden entries (Kubernetes' ..data links) are skipped.
func ReadPasswordDir(dir string) ([]Password, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	contents := map[string]string{}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		path := filepath.Join(dir, name)
		info, err := os.Stat(path) // follows the Secret volume's symlinks
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("%s is not a regular file", path)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		contents[name] = strings.TrimSpace(string(data))
	}

	var passwords []Password
	for name, value := range contents {
		if strings.HasSuffix(name, validUntilSuffix) {
			if _, ok := contents[strings.TrimSuffix(name, validUntilSuffix)]; !ok {
				return nil, fmt.Errorf("%s: no password file %s next to it", filepath.Join(dir, name), strings.TrimSuffix(name, validUntilSuffix))
			}
			continue
		}
		if len(value) < MinPasswordLength {
			return nil, fmt.Errorf("%s: a password needs at least %d characters", filepath.Join(dir, name), MinPasswordLength)
		}
		sum := sha256.Sum256([]byte(value))
		p := Password{File: name, SHA256Hex: hex.EncodeToString(sum[:])}
		if raw, ok := contents[name+validUntilSuffix]; ok {
			until, err := time.Parse(time.RFC3339, raw)
			if err != nil {
				return nil, fmt.Errorf("%s: want an RFC 3339 instant: %w", filepath.Join(dir, name+validUntilSuffix), err)
			}
			p.ValidUntil = &until
		}
		passwords = append(passwords, p)
	}
	if len(passwords) > MaxPasswordFiles {
		return nil, fmt.Errorf("%s holds %d password files, at most %d are allowed; give each user a directory of its own", dir, len(passwords), MaxPasswordFiles)
	}
	sort.Slice(passwords, func(i, j int) bool { return passwords[i].File < passwords[j].File })
	return passwords, nil
}
