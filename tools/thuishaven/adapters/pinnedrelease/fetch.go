// Package pinnedrelease installs a pinned release asset into haven's home: it
// downloads the asset, checks its sha256 and only then puts the binary in
// place, so a binary that exists is a verified one. The one downloader every
// native host process (ClickHouse, Tempo, Alloy) uses.
package pinnedrelease

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Ensure returns dest, downloading and verifying the artifact first when dest
// does not exist yet. A tar.gz or .zip artifact names the Member it unpacks.
func Ensure(ctx context.Context, a domain.PinnedArtifact, dest string) (string, error) {
	if _, err := os.Stat(dest); err == nil {
		return dest, nil
	}
	if a.URL == "" {
		return "", errors.New("no artifact is pinned for this machine")
	}
	dir := filepath.Dir(dest)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	unlock, err := lock(ctx, dest+".lock")
	if err != nil {
		return "", err
	}
	defer unlock()
	if _, err := os.Stat(dest); err == nil { // another run finished while we waited
		return dest, nil
	}
	fmt.Printf("downloading %s (first run only) ...\n", a.URL)
	asset, err := download(ctx, a, dir)
	if err != nil {
		return "", err
	}
	defer func() { _ = os.Remove(asset) }()
	bin := asset
	if a.Member != "" {
		extract := unpack
		if strings.HasSuffix(a.URL, ".zip") {
			extract = unzip
		}
		if bin, err = extract(asset, a.Member, dir); err != nil {
			return "", fmt.Errorf("unpack %s from %s: %w", a.Member, a.URL, err)
		}
		defer func() { _ = os.Remove(bin) }() // a no-op once renamed into place
	}
	if err := os.Chmod(bin, 0o755); err != nil { // #nosec G302 -- an executable haven runs
		return "", err
	}
	return dest, os.Rename(bin, dest)
}

// lock takes an exclusive flock on path, polling so ctx can end the wait. The
// file is dest's own, never another package's lock: a second flock on one file
// from one process would deadlock.
func lock(ctx context.Context, path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600) // #nosec G304 -- dest plus ".lock"
	if err != nil {
		return nil, err
	}
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return func() {
				_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
				_ = f.Close()
			}, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) {
			_ = f.Close()
			return nil, err
		}
		select {
		case <-ctx.Done():
			_ = f.Close()
			return nil, ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}

// download writes the asset to a temp file in dir, hashing while it writes,
// and returns the file only when the digest matched.
func download(ctx context.Context, a domain.PinnedArtifact, dir string) (path string, err error) {
	tmp, err := os.CreateTemp(dir, "download-*.part")
	if err != nil {
		return "", err
	}
	defer func() {
		_ = tmp.Close()
		if err != nil {
			_ = os.Remove(tmp.Name())
		}
	}()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("download %s: %w", a.URL, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: HTTP %d", a.URL, resp.StatusCode)
	}
	sum := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, sum), resp.Body); err != nil {
		return "", fmt.Errorf("download %s: %w", a.URL, err)
	}
	if got := hex.EncodeToString(sum.Sum(nil)); got != a.SHA256 {
		return "", fmt.Errorf("download %s: sha256 %s, want %s", a.URL, got, a.SHA256)
	}
	return tmp.Name(), tmp.Close()
}

// unpack copies the regular file named member (at any depth) out of a
// verified tar.gz into a temp file in dir.
func unpack(archive, member, dir string) (path string, err error) {
	f, err := os.Open(archive) // #nosec G304 -- the temp file download just wrote
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", err
	}
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return "", errors.New("not in the archive")
		}
		if err != nil {
			return "", err
		}
		if hdr.Typeflag == tar.TypeReg && filepath.Base(hdr.Name) == member {
			return copyMember(tr, hdr.Size, dir)
		}
	}
}

// unzip copies the regular file named member (at any depth) out of a
// verified zip into a temp file in dir.
func unzip(archive, member, dir string) (path string, err error) {
	zr, err := zip.OpenReader(archive)
	if err != nil {
		return "", err
	}
	defer func() { _ = zr.Close() }()
	for _, f := range zr.File {
		if !f.Mode().IsRegular() || filepath.Base(f.Name) != member {
			continue
		}
		return copyZipMember(f, dir)
	}
	return "", errors.New("not in the archive")
}

// copyZipMember unpacks one zip entry; the loop returns on the first match.
func copyZipMember(f *zip.File, dir string) (string, error) {
	rc, err := f.Open()
	if err != nil {
		return "", err
	}
	defer func() { _ = rc.Close() }()
	return copyMember(rc, int64(f.UncompressedSize64), dir) // #nosec G115 -- a size the zip declares, bounded by CopyN
}

func copyMember(r io.Reader, size int64, dir string) (path string, err error) {
	out, err := os.CreateTemp(dir, "unpack-*.part")
	if err != nil {
		return "", err
	}
	defer func() {
		if err != nil {
			_ = os.Remove(out.Name())
		}
	}()
	// CopyN at the header's size bounds what the archive can make us write.
	if _, err := io.CopyN(out, r, size); err != nil {
		_ = out.Close()
		return "", err
	}
	return out.Name(), out.Close()
}
