package access

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"

	"gopkg.in/yaml.v3"
)

// TiersFileName and ProfilesFileName are the users.d files holding the
// constraints a user's own settings are checked against.
const (
	TiersFileName    = "access-tiers.yaml"
	ProfilesFileName = "profiles.yaml"
)

// Constraint is one rendered settings constraint. ClickHouse checks it only on
// SET, never on a profile's own values, so the plan checks those itself.
type Constraint struct {
	Const    bool
	Min, Max *float64
}

// Constraints are the rendered constraints, by profile name.
type Constraints map[string]map[string]Constraint

// LoadConstraints reads the constraints the image rendered into usersD: the
// default profile's and each tier's. A missing file contributes none.
func LoadConstraints(usersD string) (Constraints, error) {
	out := Constraints{}
	for _, name := range []string{ProfilesFileName, TiersFileName} {
		data, err := os.ReadFile(filepath.Join(usersD, name))
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		var doc struct {
			Profiles map[string]struct {
				Constraints map[string]map[string]any `yaml:"constraints"`
			} `yaml:"profiles"`
		}
		if err := yaml.Unmarshal(data, &doc); err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		for profile, body := range doc.Profiles {
			for setting, c := range body.Constraints {
				if out[profile] == nil {
					out[profile] = map[string]Constraint{}
				}
				out[profile][setting] = parseConstraint(c)
			}
		}
	}
	return out, nil
}

func parseConstraint(c map[string]any) Constraint {
	var out Constraint
	_, out.Const = c["const"]
	if v, ok := number(c["min"]); ok {
		out.Min = &v
	}
	if v, ok := number(c["max"]); ok {
		out.Max = &v
	}
	return out
}

func number(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case float64:
		return n, true
	}
	return 0, false
}

// violations lists how u's own settings break the constraints of the default
// profile and of its tier. A capped setting at 0 means unlimited, so it breaks the cap.
func (c Constraints) violations(u User) []string {
	var out []string
	names := make([]string, 0, len(u.Settings))
	for name := range u.Settings {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		for _, profile := range []string{"default", u.Tier.Name()} {
			con, ok := c[profile][name]
			if !ok {
				continue
			}
			if v := checkConstraint(name, u.Settings[name], con); v != "" {
				out = append(out, fmt.Sprintf("%s (profile %s)", v, profile))
			}
		}
	}
	return out
}

func checkConstraint(name string, value any, c Constraint) string {
	if c.Const {
		return fmt.Sprintf("setting %q is pinned", name)
	}
	if c.Min == nil && c.Max == nil {
		return ""
	}
	v, ok := number(value)
	switch {
	case !ok:
		return fmt.Sprintf("setting %q is capped and must be a number", name)
	case c.Max != nil && (v <= 0 || v > *c.Max):
		return fmt.Sprintf("setting %q = %v is outside the cap of %v (0 means unlimited)", name, value, *c.Max)
	case c.Min != nil && v < *c.Min:
		return fmt.Sprintf("setting %q = %v is below the floor of %v", name, value, *c.Min)
	}
	return ""
}
