package seedgen

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
)

// Tier is a preset over the flags (design §4). Logs follow spans 1:1, metric points 2:1.
type Tier struct {
	Name                  string
	Orgs, Projects, Users int
	Traces, Spans         int
	Private               int
}

// Tiers are the four presets of design §4, in size order.
var Tiers = []Tier{
	{Name: "tiny", Orgs: 4, Projects: 6, Users: 12, Traces: 300, Spans: 1_500},
	{Name: "small", Orgs: 6, Projects: 16, Users: 60, Traces: 10_000, Spans: 50_000, Private: 1},
	{Name: "medium", Orgs: 12, Projects: 48, Users: 400, Traces: 60_000, Spans: 300_000, Private: 2},
	{Name: "large", Orgs: 24, Projects: 120, Users: 1_200, Traces: 400_000, Spans: 2_000_000, Private: 2},
}

// Personas are the four personas of design §7, in plan order.
var Personas = []string{"startup", "enterprise", "gateway", "agent-eval"}

// Shapes are the deployment shapes of design §7.7.
var Shapes = []string{"saas", "sh-licensed", "sh-free"}

// MaxSpans is the largest --spans a haven seed takes; larger volumes are upgradelab's (design §4).
const MaxSpans = 2_000_000

// MaxDays bounds --days.
const MaxDays = 365

// Flags are the seed's inputs; the same Flags give the same plan.
type Flags struct {
	Size     string    `json:"size"`
	Spans    int       `json:"spans"`
	Days     int       `json:"days"`
	Personas []string  `json:"personas"`
	Private  int       `json:"private"`
	Seed     int64     `json:"seed"`
	Anchor   time.Time `json:"anchor"`
	Shape    string    `json:"shape"`
	DryRun   bool      `json:"-"`
}

// FlagError refuses a flag before anything is written: exit 2, naming the flag and what it accepts.
type FlagError struct {
	Flag, Value, Accepts string
}

func (e *FlagError) Error() string {
	return fmt.Sprintf("--%s: %q is not accepted; want %s", e.Flag, e.Value, e.Accepts)
}

// ParseFlags reads seed flags; --spans and --private (-1) default to the tier's, --anchor to anchor.
func ParseFlags(args []string, anchor time.Time) (Flags, error) {
	set := flag.NewFlagSet("seed", flag.ContinueOnError)
	set.SetOutput(io.Discard)
	size := set.String("size", "small", "")
	spans := set.Int("spans", -1, "")
	days := set.Int("days", 30, "")
	personas := set.String("persona", "all", "")
	private := set.Int("private", -1, "")
	seed := set.Int64("seed", 1, "")
	anchorText := set.String("anchor", "", "")
	shape := set.String("shape", "saas", "")
	dryRun := set.Bool("dry-run", false, "")
	if err := set.Parse(args); err != nil {
		return Flags{}, err
	}
	if set.NArg() > 0 {
		return Flags{}, fmt.Errorf("unexpected argument %q", set.Arg(0))
	}
	flags := Flags{Size: *size, Spans: *spans, Days: *days, Private: *private, Seed: *seed, Shape: *shape,
		DryRun: *dryRun, Anchor: anchor.UTC()}
	if *anchorText != "" {
		parsed, err := time.Parse(time.RFC3339, *anchorText)
		if err != nil {
			return Flags{}, &FlagError{Flag: "anchor", Value: *anchorText, Accepts: "an RFC3339 instant"}
		}
		flags.Anchor = parsed.UTC()
	}
	flags.Personas = Personas
	if *personas != "all" {
		flags.Personas = strings.Split(*personas, ",")
	}
	return flags.withDefaults()
}

// withDefaults validates the flags and fills tier defaults.
func (f Flags) withDefaults() (Flags, error) {
	tier, ok := TierNamed(f.Size)
	if !ok {
		return f, &FlagError{Flag: "size", Value: f.Size, Accepts: "one of " + tierNames()}
	}
	if f.Spans == -1 {
		f.Spans = tier.Spans
	}
	if f.Private == -1 {
		f.Private = tier.Private
	}
	personas, refusals := f.validate()
	f.Personas = personas
	return f, errors.Join(refusals...)
}

// validate names every refused flag and returns the selected personas in plan order.
func (f Flags) validate() ([]string, []error) {
	var refusals []error
	if f.Spans < 1 || f.Spans > MaxSpans {
		refusals = append(refusals, &FlagError{Flag: "spans", Value: fmt.Sprint(f.Spans),
			Accepts: fmt.Sprintf("1 to %d", MaxSpans)})
	}
	if f.Days < 1 || f.Days > MaxDays {
		refusals = append(refusals, &FlagError{Flag: "days", Value: fmt.Sprint(f.Days),
			Accepts: fmt.Sprintf("1 to %d", MaxDays)})
	}
	if f.Private < 0 {
		refusals = append(refusals, &FlagError{Flag: "private", Value: fmt.Sprint(f.Private), Accepts: "0 or more"})
	}
	if !slices.Contains(Shapes, f.Shape) {
		refusals = append(refusals, &FlagError{Flag: "shape", Value: f.Shape, Accepts: "one of " + strings.Join(Shapes, ", ")})
	}
	for _, persona := range f.Personas {
		if !slices.Contains(Personas, persona) {
			refusals = append(refusals, &FlagError{Flag: "persona", Value: persona,
				Accepts: "all or a list of " + strings.Join(Personas, ", ")})
		}
	}
	if f.Anchor.IsZero() {
		refusals = append(refusals, &FlagError{Flag: "anchor", Accepts: "an RFC3339 instant"})
	}
	// Plan order is persona order, whatever order the flag listed them in.
	return slices.DeleteFunc(slices.Clone(Personas), func(p string) bool { return !slices.Contains(f.Personas, p) }), refusals
}

// TierNamed finds a tier by name.
func TierNamed(name string) (Tier, bool) {
	index := slices.IndexFunc(Tiers, func(t Tier) bool { return t.Name == name })
	if index < 0 {
		return Tier{}, false
	}
	return Tiers[index], true
}

func tierNames() string {
	names := make([]string, len(Tiers))
	for i, tier := range Tiers {
		names[i] = tier.Name
	}
	return strings.Join(names, ", ")
}
