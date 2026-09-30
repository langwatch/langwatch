package visualdiff

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// Edition is which license the seeded organization runs under while a pass
// captures. Each ref seeds its own license onto Organization.license (the branch
// signs one only with the root .env's license keys), and a null license is the
// open-source plan on both, so one stack serves both editions by flipping that
// column between passes - no second boot.
type Edition string

// The two editions: the seeded signed license, and none at all.
const (
	EditionEnterprise Edition = "enterprise"
	EditionFree       Edition = "free"
)

// DefaultEditions is what a run captures when -editions is not given.
// Enterprise only: a free pass doubles the run, so it is asked for by name.
var DefaultEditions = []Edition{EditionEnterprise}

// SeededOrganizationID is the organization both refs' seeds create.
const SeededOrganizationID = "local-dev-organization"

// ParseEditions reads a comma-separated -editions value.
func ParseEditions(value string) ([]Edition, error) {
	names := splitList(value)
	if len(names) == 0 {
		return append([]Edition(nil), DefaultEditions...), nil
	}
	editions := make([]Edition, 0, len(names))
	seen := map[Edition]bool{}
	for _, name := range names {
		edition := Edition(name)
		if edition != EditionEnterprise && edition != EditionFree {
			return nil, fmt.Errorf("edition %q: want %s or %s", name, EditionEnterprise, EditionFree)
		}
		if !seen[edition] {
			editions = append(editions, edition)
			seen[edition] = true
		}
	}
	return editions, nil
}

// EditionStack is one haven stack whose license a pass sets: enough to reach
// its database again from a later recapture.
type EditionStack struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
	Dir  string `json:"dir"`
}

// editionSwitch sets the seeded organization's license on haven stacks. The
// enterprise license is read back from the stack itself before the first
// free pass nulls it, so the switch never has to carry a license of its own.
// current is the edition the stacks are known to be in: enterprise straight
// after the seed, unknown ("") on a recapture.
type editionSwitch struct {
	run      runner
	environ  func() []string
	licenses map[string]string
	current  Edition
}

func newEditionSwitch(run runner, environ func() []string, current Edition) *editionSwitch {
	return &editionSwitch{run: run, environ: environ, licenses: map[string]string{}, current: current}
}

// Set puts every stack into edition, returning the first failure.
func (switcher *editionSwitch) Set(ctx context.Context, edition Edition, stacks []EditionStack) error {
	if edition == switcher.current {
		return nil
	}
	switcher.current = ""
	for _, stack := range stacks {
		if err := switcher.setOne(ctx, edition, stack); err != nil {
			return fmt.Errorf("%s edition on %s (%s): %w", edition, stack.Name, stack.Slug, err)
		}
	}
	switcher.current = edition
	return nil
}

func (switcher *editionSwitch) setOne(ctx context.Context, edition Edition, stack EditionStack) error {
	url, err := switcher.databaseURL(ctx, stack)
	if err != nil {
		return err
	}
	if _, known := switcher.licenses[stack.Slug]; !known {
		stored, err := switcher.sql(ctx, url, `SELECT coalesce(license, '') FROM "Organization" WHERE id = '`+SeededOrganizationID+`'`)
		if err != nil {
			return err
		}
		switcher.licenses[stack.Slug] = strings.TrimSpace(stored)
	}
	license := switcher.licenses[stack.Slug]
	if edition == EditionEnterprise && license == "" {
		return fmt.Errorf("the seed wrote no license for %s, so there is no enterprise edition to restore", SeededOrganizationID)
	}
	value := "NULL"
	if edition == EditionEnterprise {
		value = "'" + strings.ReplaceAll(license, "'", "''") + "'"
	}
	_, err = switcher.sql(ctx, url, `UPDATE "Organization" SET license = `+value+` WHERE id = '`+SeededOrganizationID+`'`)
	return err
}

func (switcher *editionSwitch) databaseURL(ctx context.Context, stack EditionStack) (string, error) {
	var out bytes.Buffer
	spec := commandSpec{name: havenrun.Command, args: []string{"db", "url"}, dir: stack.Dir, env: havenEnv(switcher.environ(), stack.Slug)}
	if err := switcher.run(ctx, spec, &out); err != nil {
		return "", fmt.Errorf("haven db url: %w", err)
	}
	for _, field := range strings.Fields(out.String()) {
		if strings.HasPrefix(field, "postgres://") || strings.HasPrefix(field, "postgresql://") {
			return field, nil
		}
	}
	return "", fmt.Errorf("haven db url answered no postgres address")
}

func (switcher *editionSwitch) sql(ctx context.Context, url, statement string) (string, error) {
	var out bytes.Buffer
	spec := commandSpec{name: "psql", args: []string{url, "-v", "ON_ERROR_STOP=1", "-tAc", statement}}
	if err := switcher.run(ctx, spec, &out); err != nil {
		return "", fmt.Errorf("psql: %w", err)
	}
	return out.String(), nil
}
