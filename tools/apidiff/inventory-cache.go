package apidiff

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// inventoryCache keeps each side's last failure-free inventories, keyed on
// the tree they were read from and the scripts that read them: a side whose
// tree has not moved since the last run (main, mostly) is not read again.
type inventoryCache struct {
	dir string
}

// inventoryCacheFor is the cache under the checkout's own .apidiff directory.
func (state *bootState) inventoryCacheFor() inventoryCache {
	return inventoryCache{dir: filepath.Join(toolDir(state.cfg.BranchDir), "inventory-cache")}
}

// inventoryCacheKey is "" for a tree that is not known, which caches nothing.
func inventoryCacheKey(tree string) string {
	if tree == "" {
		return ""
	}
	digest := sha256.New()
	fmt.Fprintf(digest, "tree=%s\n", tree)
	err := fs.WalkDir(inventoryScripts, ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		content, err := inventoryScripts.ReadFile(path)
		if err != nil {
			return err
		}
		fmt.Fprintf(digest, "%s %x\n", path, sha256.Sum256(content))
		return nil
	})
	if err != nil {
		return ""
	}
	return hex.EncodeToString(digest.Sum(nil))
}

// inventoryKinds are the two manifests a side's inventory writes.
var inventoryKinds = []string{"trpc", "routes"}

func (cache inventoryCache) path(side, key, kind string) string {
	return filepath.Join(cache.dir, side+"-"+key+"-"+kind+".json")
}

// restore copies a side's cached manifests to where the inventories would
// have written them, false when either is missing.
func (cache inventoryCache) restore(side, key string, outFiles map[string]string) bool {
	if key == "" {
		return false
	}
	for _, kind := range inventoryKinds {
		if err := copyFile(cache.path(side, key, kind), outFiles[kind]); err != nil {
			return false
		}
	}
	return true
}

// store keeps a side's manifests under key and drops the side's older keys.
// Each file lands by rename, so a run reading the cache never sees half of one.
func (cache inventoryCache) store(side, key string, outFiles map[string]string) error {
	if err := os.MkdirAll(cache.dir, 0o750); err != nil {
		return err
	}
	keep := map[string]bool{}
	for _, kind := range inventoryKinds {
		target := cache.path(side, key, kind)
		keep[filepath.Base(target)] = true
		if err := copyFile(outFiles[kind], target+".tmp"); err != nil {
			return err
		}
		if err := os.Rename(target+".tmp", target); err != nil {
			return err
		}
	}
	return cache.dropOthers(side, keep)
}

// dropOthers removes the side's cached files that keep does not name.
func (cache inventoryCache) dropOthers(side string, keep map[string]bool) error {
	entries, err := os.ReadDir(cache.dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), side+"-") && !keep[entry.Name()] {
			_ = os.Remove(filepath.Join(cache.dir, entry.Name()))
		}
	}
	return nil
}

func copyFile(from, to string) error {
	content, err := os.ReadFile(from) // #nosec G304 -- manifests under the tool's own .apidiff directory and work root.
	if err != nil {
		return err
	}
	return os.WriteFile(to, content, 0o600) // #nosec G703 -- to is a path this tool built under .apidiff or the work root.
}
