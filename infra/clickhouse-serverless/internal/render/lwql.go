package render

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// The two files the app's access-render Job writes into the LangWatchQL
// access Secret, and where ClickHouse must find each one.
const (
	lwqlAccessFile          = "lwql-access.yaml"
	lwqlNamedCollectionFile = "lwql-named-collection.yaml"
)

// linkLWQLAccess links the LangWatchQL access model from dir into users.d and
// config.d. A link, not a copy: a mounted Secret is updated in place, and
// ClickHouse re-reads both directories, so the server picks up a new access
// model with no restart. A single-file subPath mount is never updated.
//
// With dir set, a missing file stops the server starting: booting without the
// access model would leave LangWatchQL failing every query. With dir unset,
// only links an earlier run made are removed; a file mounted at the same path
// (an older chart's subPath mount) is left alone.
func linkLWQLAccess(dir, usersD, configD string) error {
	links := []struct{ target, link string }{
		{lwqlAccessFile, filepath.Join(usersD, lwqlAccessFile)},
		{lwqlNamedCollectionFile, filepath.Join(configD, lwqlNamedCollectionFile)},
	}
	for _, l := range links {
		isLink, err := isSymlink(l.link)
		if err != nil {
			return err
		}
		if dir == "" {
			if isLink {
				if err := os.Remove(l.link); err != nil {
					return err
				}
			}
			continue
		}
		target := filepath.Join(dir, l.target)
		if _, err := os.Stat(target); err != nil {
			return fmt.Errorf("LWQL_ACCESS_DIR: %w", err)
		}
		if isLink {
			if err := os.Remove(l.link); err != nil {
				return err
			}
		}
		if err := os.Symlink(target, l.link); err != nil {
			// EEXIST: something else is mounted there, such as a subPath mount.
			return fmt.Errorf("link %s: %w (mount the access model only as LWQL_ACCESS_DIR)", l.link, err)
		}
	}
	return nil
}

func isSymlink(path string) (bool, error) {
	fi, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return fi.Mode()&fs.ModeSymlink != 0, nil
}
