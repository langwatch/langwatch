package ecrtag

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
)

// Source is where a tag records the commit it was published for.
type Source string

const (
	// Label is the revision label of a single manifest pushed by a build.
	Label Source = "label"
	// Annotation is the revision annotation of an index written by
	// `docker buildx imagetools create`.
	Annotation Source = "annotation"
)

// Check is one tag a publish step is about to write.
type Check struct {
	Ref
	Source Source
	// Revision is the full sha of the commit being published.
	Revision string
	// Custom is a dispatcher's tag rather than the default commit tag. One
	// already there may name another commit's image, so it is never skipped.
	Custom bool
	// AcceptDigest, when set, is the manifest a re-tag for this commit would
	// copy. A default tag naming exactly it is published without a revision.
	AcceptDigest string
}

// Published reports false when the tag is not there (write it) and true when it
// is there and holds what this run would have published (skip it). Any other
// state is an error, and the caller writes nothing.
func Published(ctx context.Context, reg Registry, c Check) (bool, error) {
	img, err := reg.Describe(ctx, c.Ref)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("could not look up %s in ECR: %w", c.Ref, err)
	}
	if c.Custom {
		return false, fmt.Errorf("%s already exists and ECR tags cannot be moved; pick a new image_tag", c.Ref)
	}
	if c.AcceptDigest != "" && img.Digest == c.AcceptDigest {
		return true, nil
	}
	revision, err := recordedRevision(ctx, reg, c)
	if err != nil {
		return false, err
	}

	if err := matchRevision(c, revision); err != nil {
		return false, err
	}

	return true, nil
}

func recordedRevision(ctx context.Context, reg Registry, c Check) (string, error) {
	switch c.Source {
	case Label:
		return reg.Label(ctx, c.Ref, RevisionKey)
	case Annotation:
		m, err := reg.Manifest(ctx, c.Ref)
		if err != nil {
			return "", err
		}

		return indexAnnotation(m.Body)
	}

	return "", fmt.Errorf("unknown revision source %q; use label or annotation", c.Source)
}

func indexAnnotation(body string) (string, error) {
	var index struct {
		Annotations map[string]string `json:"annotations"`
	}
	if err := json.Unmarshal([]byte(body), &index); err != nil {
		return "", fmt.Errorf("parse the image index: %w", err)
	}

	return index.Annotations[RevisionKey], nil
}

func matchRevision(c Check, revision string) error {
	if revision == "" {
		return fmt.Errorf("%s is already in ECR but records no %s, so this run cannot tell whether it was built from %s; it was published before the revision was recorded, and the tag cannot be moved",
			c.Ref, RevisionKey, c.Revision)
	}
	if revision != c.Revision {
		return fmt.Errorf("%s is already in ECR for commit %s, not %s; the short sha is shared, and the tag cannot be moved",
			c.Ref, revision, c.Revision)
	}

	return nil
}

// Retag is a re-tag of Ref for the commit Head: it copies the image of the
// nearest ancestor's git-<sha>.
type Retag struct {
	Registry Registry
	Ancestry Ancestry
	Ref
	Head string
}

// Source is the tag the re-tag would copy and the digest it names. The tag
// itself is no candidate, or an existing one would always match itself. Both
// are "" when no ancestor has an image.
func (r Retag) Source(ctx context.Context) (string, string, error) {
	tags, err := r.Registry.Tags(ctx, r.Repository)
	if err != nil {
		return "", "", fmt.Errorf("list the tags of %s: %w", r.Repository, err)
	}
	tags = slices.DeleteFunc(tags, func(t string) bool { return t == r.Tag })
	previous, err := r.Ancestry.Nearest(ctx, tags, r.Head)
	if err != nil || previous == "" {
		return "", "", err
	}
	img, err := r.Registry.Describe(ctx, Ref{Repository: r.Repository, Tag: previous})
	if err != nil {
		return "", "", fmt.Errorf("look up %s:%s: %w", r.Repository, previous, err)
	}

	return previous, img.Digest, nil
}
