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

// Base is a change set: it runs from Tag to the head, and Rebuild lists every
// repository whose re-tag would copy an image newer than Tag. A change made
// after Tag and reverted shows no difference, so those cannot trust the diff.
type Base struct {
	Tag     string   `json:"base"`
	Rebuild []string `json:"rebuild"`
}

// Find returns the furthest back of the re-tag sources on Head's first-parent
// history, so every commit since any image a re-tag copies is in the change
// set. A repository with no source is skipped; Tag is "" when none has one.
func (d DiffBase) Find(ctx context.Context) (Base, error) {
	byRepository, err := d.sources(ctx)
	if err != nil {
		return Base{}, err
	}
	oldest, err := d.oldest(ctx, byRepository)
	if err != nil {
		return Base{}, err
	}
	base := Base{Tag: oldest, Rebuild: []string{}}
	for _, repository := range d.Repositories {
		if source := byRepository[repository]; source != "" && source != oldest {
			base.Rebuild = append(base.Rebuild, repository)
		}
	}

	return base, nil
}

// sources is each repository's re-tag source, "" for one never published.
func (d DiffBase) sources(ctx context.Context) (map[string]string, error) {
	sources := map[string]string{}
	for _, repository := range d.Repositories {
		retag := Retag{Registry: d.Registry, Ancestry: d.Ancestry, Ref: Ref{Repository: repository, Tag: d.Tag}, Head: d.Head}
		previous, _, err := retag.Source(ctx)
		if err != nil {
			return nil, err
		}
		sources[repository] = previous
	}

	return sources, nil
}

// oldest: every source is on Head's first-parent history, so dropping the
// nearest until one is left leaves the furthest back.
func (d DiffBase) oldest(ctx context.Context, byRepository map[string]string) (string, error) {
	var sources []string
	for _, source := range byRepository {
		if source != "" && !slices.Contains(sources, source) {
			sources = append(sources, source)
		}
	}
	slices.Sort(sources)
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
