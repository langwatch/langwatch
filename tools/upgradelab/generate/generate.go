// Package generate plans and runs `upgradelab generate`: a seeded run against a booted old release
// (an image in CI, ruling D12) that ends in a snapshot capture (plan-upgrade-snapshots lane L3).
// Planning is pure; each door runs behind Doors so tests use a fake.
package generate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/seed"
)

// Floor is the oldest release an upgrade accepts (the LTS floor).
const Floor = "3.20.1"

var (
	mainRelease  = regexp.MustCompile(`^main@[0-9a-f]{7,40}$`)
	tagRelease   = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)$`)
	trafficKinds = []string{"otlp", "collector", "evaluation", "monitor", "annotation", "scenario", "batch", "automation", "analytics"}
)

// Request is one generate invocation.
type Request struct {
	Shape, Release, Volume string
	Seed                   int64
	Anchor                 time.Time
}

// Step is one door: Name says which, Args carry what the door needs.
type Step struct {
	Name string            `json:"name"`
	Args map[string]string `json:"args,omitempty"`
}

// Plan is the logical run; equal requests give equal plans and digests.
type Plan struct {
	Request  Request
	Tenancy  seed.Tenancy
	TenancyS string
	Steps    []Step
}

// Doors runs one step against the real stores and old release.
type Doors interface {
	Run(ctx context.Context, plan Plan, step Step) error
}

// Build validates the request and lays out the steps.
func Build(request Request) (Plan, error) {
	if !slices.Contains(seed.Shapes, request.Shape) {
		return Plan{}, fmt.Errorf("unknown shape %q: want one of %s", request.Shape, strings.Join(seed.Shapes, ", "))
	}
	cloud := request.Shape == "saas" || request.Shape == "hybrid"
	switch {
	case request.Volume != "S":
		return Plan{}, fmt.Errorf("volume %q: only S here; L and XL land with the scale generator (lane L4)", request.Volume)
	case cloud && !mainRelease.MatchString(request.Release):
		return Plan{}, fmt.Errorf("release %q: cloud shapes come from main@<sha>, cloud never runs a release tag", request.Release)
	case !cloud && !tagRelease.MatchString(request.Release):
		return Plan{}, fmt.Errorf("release %q: self-hosted shapes come from a release tag", request.Release)
	case !cloud && belowFloor(request.Release):
		return Plan{}, fmt.Errorf("release %s is below the floor %s; the 3.19.4 refusal recipe is an overlay (lane L5)", request.Release, Floor)
	}
	tenancy := seed.BuildTenancy(seed.TenancyInput{Shape: request.Shape, Seed: request.Seed, Anchor: request.Anchor, Cloud: cloud})
	seedText := strconv.FormatInt(request.Seed, 10)
	steps := []Step{
		{Name: "stores-up"},
		{Name: "old-release-up", Args: map[string]string{"release": request.Release, "shape": request.Shape}},
		{Name: "tenancy-sql"},
		{Name: "product-seeds", Args: map[string]string{"organization": tenancy.Organizations[0].ID, "project": tenancy.Projects[0].ID}},
		{Name: "traffic", Args: map[string]string{"families": strings.Join(trafficKinds, ","), "n": "20", "seed": seedText}},
		{Name: "pause-worker"},
		{Name: "traffic-at-cut", Args: map[string]string{"families": "otlp", "n": "5", "seed": seedText}},
		{Name: "capture", Args: map[string]string{"anchor": request.Anchor.UTC().Format(time.RFC3339)}},
	}
	return Plan{Request: request, Tenancy: tenancy, TenancyS: tenancy.SQL(), Steps: steps}, nil
}

func belowFloor(release string) bool {
	parse := func(value string) [3]int {
		var parts [3]int
		for i, part := range tagRelease.FindStringSubmatch(value)[1:] {
			parts[i], _ = strconv.Atoi(part)
		}
		return parts
	}
	got, floor := parse(release), parse(Floor)
	return slices.Compare(got[:], floor[:]) < 0
}

// Digest is the hash of the logical plan: the fingerprint input two runs with one seed share.
func (plan Plan) Digest() string {
	data, _ := json.Marshal(struct {
		Request Request
		Tenancy string
		Steps   []Step
	}{plan.Request, plan.TenancyS, plan.Steps})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// Execute runs every door in order and stops at the first failure, naming its step.
func Execute(ctx context.Context, plan Plan, doors Doors) error {
	for _, step := range plan.Steps {
		if err := doors.Run(ctx, plan, step); err != nil {
			return fmt.Errorf("generate step %s: %w", step.Name, err)
		}
	}
	return nil
}

// Command parses `generate` flags and prints the plan as JSON; cli.go dispatches to it.
func Command(ctx context.Context, args []string, stdout io.Writer) error {
	var request Request
	var anchor string
	var options DoorsOptions
	flags := flag.NewFlagSet("generate", flag.ContinueOnError)
	flags.StringVar(&request.Shape, "shape", "", strings.Join(seed.Shapes, " | "))
	flags.StringVar(&request.Release, "release", "", "a release tag (self-hosted) or main@<sha> (cloud)")
	flags.StringVar(&request.Volume, "volume", "S", "S (L and XL: lane L4)")
	flags.Int64Var(&request.Seed, "seed", 1, "every id, variant and instant derives from it")
	flags.StringVar(&anchor, "anchor", time.Now().UTC().Format("2006-01")+"-01", "first day of the anchor month, YYYY-MM-DD")
	flags.StringVar(&options.Out, "out", "", "run the doors and capture into this empty directory (default: print the plan)")
	flags.StringVar(&options.Image, "image", "", "the old image; required for main@<sha>, a tag defaults to langwatch/langwatch:<tag>")
	flags.StringVar(&options.Commit, "commit", "", "the generator commit the manifest records")
	if err := flags.Parse(args); err != nil {
		return err
	}
	at, err := time.Parse(time.DateOnly, anchor)
	if err != nil {
		return errors.New("-anchor wants YYYY-MM-DD")
	}
	request.Anchor = at
	plan, err := Build(request)
	if err != nil {
		return err
	}
	if options.Out != "" {
		doors, err := NewComposeDoors(plan, options)
		if err != nil {
			return err
		}
		return Execute(ctx, plan, doors)
	}
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(map[string]any{"digest": plan.Digest(), "request": request, "steps": plan.Steps, "tenancySQL": plan.TenancyS})
}
