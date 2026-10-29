package ecrtag

import (
	"context"
	"errors"
	"fmt"
	"io"
)

// Lambda gives one Lambda function image this commit's tag. A Lambda function
// image cannot be an index, so the tag is a plain manifest, copied with the
// ECR API rather than `docker buildx imagetools create` (which writes an index).
type Lambda struct {
	Registry Registry
	Ancestry Ancestry
	// Ref is the image and the tag to publish.
	Ref
	// Head is the commit being published and Revision its full sha.
	Head     string
	Revision string
	// Built is true when this run rebuilt the image and so pushed Tag itself;
	// otherwise the image of the nearest ancestor of Head is re-tagged as Tag.
	Built bool
	// Custom is a dispatcher's tag: one already there fails.
	Custom bool
	// Log receives what was done and the ::warning:: an unseeded image gets.
	Log io.Writer
}

func (l Lambda) ref(tag string) Ref { return Ref{Repository: l.Repository, Tag: tag} }

// Publish makes sure Tag names a single manifest of this commit's image, and
// writes nothing it cannot prove belongs to this commit. It returns false, with
// a warning logged, when no ancestor has an image to re-tag.
func (l Lambda) Publish(ctx context.Context) (bool, error) {
	if l.Built {
		return true, l.checkBuilt(ctx)
	}

	return l.retag(ctx)
}

// checkBuilt: the build pushed the tag itself. Missing means that build failed.
func (l Lambda) checkBuilt(ctx context.Context) error {
	img, err := l.Registry.Describe(ctx, l.Ref)
	if errors.Is(err, ErrNotFound) {
		return fmt.Errorf("%s was due to be built this run and is not in ECR; see build-and-push-lambda", l.Ref)
	}
	if err != nil {
		return fmt.Errorf("could not look up %s in ECR: %w", l.Ref, err)
	}
	if !IsSingleManifest(img.MediaType) {
		return fmt.Errorf("%s is %s, not a single manifest; see build-and-push-lambda", l.Ref, img.MediaType)
	}
	// A build labels its image with this commit; a push run's re-tag keeps
	// the ancestor's label, and the tag cannot be moved to this build.
	label, err := l.Registry.Label(ctx, l.Ref, RevisionKey)
	if err != nil {
		return err
	}
	if label != l.Revision {
		return errRetagged(l.Ref)
	}

	return nil
}

func (l Lambda) retag(ctx context.Context) (bool, error) {
	previous, digest, err := Retag{Registry: l.Registry, Ancestry: l.Ancestry, Ref: l.Ref, Head: l.Head}.Source(ctx)
	if err != nil {
		return false, err
	}
	done, err := Published(ctx, l.Registry, Check{
		Ref: l.Ref, Source: Label,
		Revision: l.Revision, Custom: l.Custom, AcceptDigest: digest,
	})
	if err != nil {
		return false, err
	}
	if done {
		_, _ = fmt.Fprintf(l.Log, "%s is already in ECR for this commit; nothing to re-tag\n", l.Ref)
		return true, nil
	}
	if previous == "" {
		_, _ = fmt.Fprintf(l.Log, "::warning::%s has no previous git-* image from an ancestor commit to re-tag as %s; run this workflow via workflow_dispatch to seed it\n", l.Repository, l.Tag)
		return false, nil
	}

	return true, l.copy(ctx, previous)
}

// copy writes Tag to name the manifest previous names, checked rather than
// assumed to be a single manifest so an index never reaches a function.
func (l Lambda) copy(ctx context.Context, previous string) error {
	m, err := l.Registry.Manifest(ctx, l.ref(previous))
	if err != nil {
		return fmt.Errorf("read %s: %w", l.ref(previous), err)
	}
	if !IsSingleManifest(m.MediaType) {
		return fmt.Errorf("%s is %s, not a single manifest; dispatch this workflow to rebuild it", l.ref(previous), m.MediaType)
	}
	_, _ = fmt.Fprintf(l.Log, "Re-tagging %s %s -> %s (unchanged by this commit)\n", l.Repository, previous, l.Tag)
	if err := l.Registry.Put(ctx, l.Ref, m); err != nil {
		return fmt.Errorf("write %s: %w", l.Ref, err)
	}

	return nil
}
