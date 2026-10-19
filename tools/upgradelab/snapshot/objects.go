package snapshot

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Objects is the S3 bucket a stack writes to; capture and restore keep every key as it is.
type Objects interface {
	Bucket() string
	List(ctx context.Context) ([]string, error)
	Get(ctx context.Context, key string) ([]byte, error)
	Put(ctx context.Context, object Object) error
}

// Object is one S3 object: its key and its body.
type Object struct {
	Key  string
	Body []byte
}

// DedicatedBucketPrefix is DedicatedPrefix for buckets, whose names allow no underscore.
const DedicatedBucketPrefix = "upgradelab-"

func checkObjectsTarget(ctx context.Context, store Objects) error {
	if store == nil {
		return nil
	}
	if !strings.HasPrefix(store.Bucket(), DedicatedBucketPrefix) {
		return fmt.Errorf("bucket %q is not dedicated: restore writes only to a bucket named %s<name>, never a stack's own", store.Bucket(), DedicatedBucketPrefix)
	}
	keys, err := store.List(ctx)
	if err != nil {
		return err
	}
	if len(keys) > 0 {
		return fmt.Errorf("bucket %q is not empty (%d objects): restore writes only into an empty dedicated bucket", store.Bucket(), len(keys))
	}
	return nil
}

// captureObjects writes objects.tar.gz in key order; every body goes through the scrub.
// ponytail: one body in memory at a time; stream Get into the tar if objects outgrow memory.
func captureObjects(ctx context.Context, store Objects, step captureStep) error {
	keys, err := store.List(ctx)
	if err != nil {
		return err
	}
	slices.Sort(keys)
	file, err := os.OpenFile(filepath.Join(step.dir, ObjectsFile), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	zipper := gzip.NewWriter(file)
	archive := tar.NewWriter(zipper)
	for _, key := range keys {
		body, err := store.Get(ctx, key)
		if err != nil {
			return fmt.Errorf("object %s: %w", key, err)
		}
		step.visit(Cell{Table: "objects", Column: key, Value: string(body)})
		if err := writeObject(archive, Object{Key: key, Body: body}); err != nil {
			return err
		}
	}
	step.manifest.ObjectCount = len(keys)
	return errors.Join(archive.Close(), zipper.Close(), file.Close())
}

func writeObject(archive *tar.Writer, object Object) error {
	header := &tar.Header{Name: object.Key, Mode: 0o600, Size: int64(len(object.Body)), Typeflag: tar.TypeReg}
	if err := archive.WriteHeader(header); err != nil {
		return err
	}
	_, err := archive.Write(object.Body)
	return err
}

func restoreObjects(ctx context.Context, store Objects, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	zipper, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("%s: %w", ObjectsFile, err)
	}
	archive := tar.NewReader(zipper)
	for {
		object, err := readObject(archive)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("%s: %w", ObjectsFile, err)
		}
		if err := store.Put(ctx, object); err != nil {
			return fmt.Errorf("object %s: %w", object.Key, err)
		}
	}
}

func readObject(archive *tar.Reader) (Object, error) {
	header, err := archive.Next()
	if err != nil {
		return Object{}, err
	}
	if header.Typeflag != tar.TypeReg {
		return Object{}, fmt.Errorf("entry %q is not a regular file", header.Name)
	}
	body, err := io.ReadAll(archive)
	return Object{Key: header.Name, Body: body}, err
}

func objectsFingerprint(store Objects) func(context.Context) (map[string]TableFingerprint, error) {
	return func(ctx context.Context) (map[string]TableFingerprint, error) {
		keys, err := store.List(ctx)
		if err != nil {
			return nil, err
		}
		rows := make([][]string, 0, len(keys))
		for _, key := range keys {
			body, err := store.Get(ctx, key)
			if err != nil {
				return nil, fmt.Errorf("object %s: %w", key, err)
			}
			sum := sha256.Sum256(body)
			rows = append(rows, []string{key, hex.EncodeToString(sum[:])})
		}
		return map[string]TableFingerprint{"objects": FoldRows(rows)}, nil
	}
}
