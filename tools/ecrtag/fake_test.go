package ecrtag_test

import (
	"context"
	"errors"
	"slices"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

const (
	this  = "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	other = "1111111bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	plain = "application/vnd.oci.image.manifest.v1+json"
	index = "application/vnd.oci.image.index.v1+json"
)

var errAccessDenied = errors.New("an error occurred (AccessDeniedException)")

type entry struct {
	digest, mediaType, body, label string
}

// fakeRegistry is one ECR repository: a tag per entry.
type fakeRegistry struct {
	tags        map[string]entry
	describeErr map[string]error
	putErr      error
	puts        []string
}

func newRegistry() *fakeRegistry {
	return &fakeRegistry{tags: map[string]entry{}, describeErr: map[string]error{}}
}

func (r *fakeRegistry) push(tag string, e entry) *fakeRegistry {
	if e.mediaType == "" {
		e.mediaType = plain
	}
	if e.digest == "" {
		e.digest = "sha256:" + tag
	}
	r.tags[tag] = e

	return r
}

func (r *fakeRegistry) Describe(_ context.Context, ref ecrtag.Ref) (ecrtag.Image, error) {
	if err := r.describeErr[ref.Tag]; err != nil {
		return ecrtag.Image{}, err
	}
	e, ok := r.tags[ref.Tag]
	if !ok {
		return ecrtag.Image{}, ecrtag.ErrNotFound
	}

	return ecrtag.Image{Digest: e.digest, MediaType: e.mediaType}, nil
}

func (r *fakeRegistry) Tags(context.Context, string) ([]string, error) {
	var tags []string
	for tag := range r.tags {
		tags = append(tags, tag)
	}
	slices.Sort(tags)

	return tags, nil
}

func (r *fakeRegistry) Manifest(_ context.Context, ref ecrtag.Ref) (ecrtag.Manifest, error) {
	e, ok := r.tags[ref.Tag]
	if !ok {
		return ecrtag.Manifest{}, ecrtag.ErrNotFound
	}

	return ecrtag.Manifest{Body: e.body, MediaType: e.mediaType}, nil
}

func (r *fakeRegistry) Put(_ context.Context, ref ecrtag.Ref, m ecrtag.Manifest) error {
	r.puts = append(r.puts, ref.Tag)
	if r.putErr != nil {
		return r.putErr
	}
	r.tags[ref.Tag] = entry{digest: "sha256:copy", mediaType: m.MediaType, body: m.Body}

	return nil
}

func (r *fakeRegistry) Label(_ context.Context, ref ecrtag.Ref, key string) (string, error) {
	if key != ecrtag.RevisionKey {
		return "", errors.New("unexpected label " + key)
	}

	return r.tags[ref.Tag].label, nil
}

// fakeAncestry walks a first-parent history, nearest commit first.
type fakeAncestry struct {
	history []string
	offered []string
}

func (a *fakeAncestry) Nearest(_ context.Context, tags []string, _ string) (string, error) {
	a.offered = tags
	for _, tag := range a.history {
		if slices.Contains(tags, tag) {
			return tag, nil
		}
	}

	return "", nil
}
