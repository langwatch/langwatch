package ecrtag

import (
	"context"
	"fmt"
)

// ImageSpec is one image a run publishes and the Dockerfile it builds from.
type ImageSpec struct {
	Image      string `json:"image"`
	Dockerfile string `json:"dockerfile"`
}

// Plan is what a run does with one image: build it, labelled with Inputs, or
// re-tag the image of the nearest ancestor (Retag.Source).
type Plan struct {
	Image  string `json:"image"`
	Inputs string `json:"inputs"`
	Build  bool   `json:"build"`
	Reason string `json:"reason"`
}

// Select decides which images a run builds. An image is re-tagged only when
// the image its re-tag would copy was built from the same inputs; anything
// it cannot show, it builds. Comparing with the image the re-tag copies, not
// with a diff, holds when a run was replaced or a change was reverted.
type Select struct {
	Registry Registry
	Ancestry Ancestry
	Inputs   Inputs
	// Tag is the commit tag being published and Head the commit.
	Tag  string
	Head string
	// All builds every image: a dispatch, which re-tags nothing.
	All bool
}

// Plan plans every image. A registry that does not answer fails the run.
func (s Select) Plan(ctx context.Context, images []ImageSpec) ([]Plan, error) {
	plans := make([]Plan, 0, len(images))
	for _, img := range images {
		p, err := s.plan(ctx, img)
		if err != nil {
			return nil, err
		}
		plans = append(plans, p)
	}

	return plans, nil
}

func (s Select) plan(ctx context.Context, img ImageSpec) (Plan, error) {
	p := Plan{Image: img.Image, Build: true}
	hash, err := s.Inputs.Hash(ctx, img.Image, img.Dockerfile)
	if err != nil {
		p.Reason = fmt.Sprintf("its inputs could not be read (%v)", err)
		return p, nil
	}
	p.Inputs = hash
	if s.All {
		p.Reason = "a dispatch builds every image"
		return p, nil
	}
	source, _, err := Retag{Registry: s.Registry, Ancestry: s.Ancestry, Ref: Ref{Repository: img.Image, Tag: s.Tag}, Head: s.Head}.Source(ctx)
	if err != nil {
		return p, err
	}
	if source == "" {
		p.Reason = "no ancestor has an image to re-tag"
		return p, nil
	}
	label, err := s.Registry.ImageLabel(ctx, Ref{Repository: img.Image, Tag: source}, InputsKey)
	if err != nil {
		return p, fmt.Errorf("read the inputs of %s:%s: %w", img.Image, source, err)
	}
	switch label {
	case "":
		p.Reason = source + " records no inputs"
	case hash:
		p.Build = false
		p.Reason = "same inputs as " + source
	default:
		p.Reason = "inputs changed since " + source
	}

	return p, nil
}
