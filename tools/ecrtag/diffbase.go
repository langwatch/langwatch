package ecrtag

import (
	"context"
	"fmt"
	"slices"
)

// DiffBase is where a push run's change set starts: the commit whose image the
// re-tag of each repository would copy (Retag.Source). A newer push replaces a
// waiting run, so the previous push is not always the last published commit.
type DiffBase struct {
	Registry     Registry
	Ancestry     Ancestry
	Repositories []string
	// Tag is the commit tag being published and Head the commit.
	Tag  string
	Head string
}

// Find returns the furthest back of the re-tag sources on Head's first-parent
// history, so every commit since any image a re-tag copies is in the change
// set. A repository with no source is skipped; "" when none has one.
func (d DiffBase) Find(ctx context.Context) (string, error) {
	sources, err := d.sources(ctx)
	if err != nil {
		return "", err
	}
	// Every source is on Head's first-parent history: dropping the nearest
	// until one is left leaves the oldest.
	for len(sources) > 1 {
		nearest, err := d.Ancestry.Nearest(ctx, sources, d.Head)
		if err != nil {
			return "", err
		}
		i := slices.Index(sources, nearest)
		if i < 0 {
			return "", fmt.Errorf("the ancestry picked %q, none of the re-tag sources %v", nearest, sources)
		}
		sources = slices.Delete(sources, i, i+1)
	}
	if len(sources) == 0 {
		return "", nil
	}

	return sources[0], nil
}

// sources is each repository's re-tag source, once each.
func (d DiffBase) sources(ctx context.Context) ([]string, error) {
	var sources []string
	for _, repository := range d.Repositories {
		retag := Retag{Registry: d.Registry, Ancestry: d.Ancestry, Ref: Ref{Repository: repository, Tag: d.Tag}, Head: d.Head}
		previous, _, err := retag.Source(ctx)
		if err != nil {
			return nil, err
		}
		if previous != "" && !slices.Contains(sources, previous) {
			sources = append(sources, previous)
		}
	}

	return sources, nil
}
