// Package ecrtag decides whether a publish step may write an image tag to the
// artifacts ECR, whose tags are immutable, and gives a Lambda image its commit
// tag. A tag already there, default or custom, is skipped only when it records
// this commit; another commit's tag, a tag that records no commit, a push
// run's re-tag met by a run that built the image and a lookup that did not
// answer all fail, so nothing is written.
//
// Spec: specs/ci/publish-ecr-images.feature
package ecrtag

import (
	"context"
	"errors"
)

// RevisionKey is the label (on a manifest) or annotation (on an index) that
// records the full commit sha an image tag was published for.
const RevisionKey = "org.opencontainers.image.revision"

// ErrNotFound is a registry's answer that a tag is not there. Every other
// lookup error means the registry did not answer.
var ErrNotFound = errors.New("image not found")

// ErrTagTaken is a write refused because the tag already names another image.
var ErrTagTaken = errors.New("tag already names another image and cannot be moved")

// Ref is one tag of one repository.
type Ref struct {
	Repository string
	Tag        string
}

func (r Ref) String() string { return r.Repository + ":" + r.Tag }

// Image is what a registry reports for one tag.
type Image struct {
	Digest    string
	MediaType string
}

// Manifest is the raw manifest a tag names.
type Manifest struct {
	Body      string
	MediaType string
}

// Registry is the one ECR registry the workflows publish to.
type Registry interface {
	// Describe returns ErrNotFound when the tag is not in the repository.
	Describe(ctx context.Context, ref Ref) (Image, error)
	// Tags lists every tag in the repository.
	Tags(ctx context.Context, repository string) ([]string, error)
	// Manifest reads the manifest or image index a tag names.
	Manifest(ctx context.Context, ref Ref) (Manifest, error)
	// Put writes the tag to name m. It returns nil when it already names m,
	// and ErrTagTaken when it names another image.
	Put(ctx context.Context, ref Ref, m Manifest) error
	// Label reads one label of the single-manifest image a tag names.
	Label(ctx context.Context, ref Ref, key string) (string, error)
}

// Ancestry picks, from git-<sha> tags, the one of the nearest commit on
// head's first-parent history. It returns "" when no tag names one.
type Ancestry interface {
	Nearest(ctx context.Context, tags []string, head string) (string, error)
}

// IsSingleManifest reports whether a media type is one manifest, which a
// Lambda function can run, rather than an index.
func IsSingleManifest(mediaType string) bool {
	switch mediaType {
	case "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json":
		return true
	}

	return false
}
