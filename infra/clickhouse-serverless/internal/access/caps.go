package access

import (
	"fmt"
	"maps"
	"math"
	"sort"
	"strings"
)

// Cappable lists the settings a user's caps may set: the image's query limits,
// each read by ClickHouse as no limit at 0, so every cap also renders a floor of 1.
var Cappable = []string{
	"max_bytes_to_read", "max_execution_time", "max_memory_usage",
	"max_result_bytes", "max_result_rows", "max_rows_to_read",
}

var cappable = set(Cappable)

// checkCaps validates a user's caps on their own and against its own settings.
func checkCaps(u User, r Rules, add func(where, format string, args ...any), where string) {
	for _, name := range sortedNames(u.Caps) {
		limit := u.Caps[name]
		switch {
		case !cappable[name]:
			add(where, "caps.%s cannot be capped (want one of %s)", name, strings.Join(Cappable, ", "))
		case r.protected[name]:
			add(where, "caps.%s is protected by the policy and cannot be changed", name)
		case limit <= 0:
			add(where, "caps.%s must be above 0, which ClickHouse reads as no limit", name)
		}
		if value, ok := u.Settings[name]; ok {
			if v, isNumber := number(value); !isNumber || v <= 0 || v > float64(limit) {
				add(where, "setting %q = %v must be a number from 1 to the user's own cap of %d", name, value, limit)
			}
		}
	}
}

// capViolations lists the caps in f that would loosen a constraint rendered for
// the default profile or the user's tier: a user's constraint replaces those
// (settings_constraints_replace_previous), so it may only be tighter.
func (c Constraints) capViolations(f *File) []string {
	var out []string
	for _, u := range f.Users {
		for _, name := range sortedNames(u.Caps) {
			limit := float64(u.Caps[name])
			for _, profile := range []string{"default", u.Tier.Name()} {
				con, ok := c[profile][name]
				switch {
				case !ok:
				case con.Const:
					out = append(out, fmt.Sprintf("users %q: caps.%s cannot be set: profile %s pins it", u.Name, name, profile))
				case con.Max != nil && limit > *con.Max:
					out = append(out, fmt.Sprintf("users %q: caps.%s = %d is above the limit of %v in profile %s; a cap may only tighten its tier",
						u.Name, name, u.Caps[name], *con.Max, profile))
				case con.Min != nil && limit < *con.Min:
					out = append(out, fmt.Sprintf("users %q: caps.%s = %d is below the floor of %v in profile %s",
						u.Name, name, u.Caps[name], *con.Min, profile))
				}
			}
		}
	}
	return out
}

// CheckCaps refuses f when a user's cap is looser than the constraints
// rendered into usersD, so a caller keeps the users already in force.
func CheckCaps(f *File, usersD string) error {
	c, err := LoadConstraints(usersD)
	if err != nil {
		return err
	}
	return c.checkCaps(f)
}

func (c Constraints) checkCaps(f *File) error {
	if v := c.capViolations(f); len(v) > 0 {
		return fmt.Errorf("invalid access file:\n  - %s", strings.Join(v, "\n  - "))
	}
	return nil
}

// ownSettings is what the user's own profile sets: its settings, each capped
// setting at its cap unless a setting is lower, and a constraint from the
// highest rendered floor (at least 1) to the cap. Without caps, its settings.
func ownSettings(u User, c Constraints) map[string]any {
	if len(u.Caps) == 0 {
		return u.Settings
	}
	out := map[string]any{}
	maps.Copy(out, u.Settings)
	constraints := map[string]any{}
	for name, limit := range u.Caps {
		if _, set := out[name]; !set {
			out[name] = limit
		}
		constraints[name] = map[string]any{"min": c.floor(u, name), "max": limit}
	}
	out["constraints"] = constraints
	return out
}

func (c Constraints) floor(u User, name string) int64 {
	floor := 1.0
	for _, profile := range []string{"default", u.Tier.Name()} {
		if con, ok := c[profile][name]; ok && con.Min != nil && *con.Min > floor {
			floor = *con.Min
		}
	}
	return int64(math.Ceil(floor))
}

func sortedNames[V any](m map[string]V) []string {
	names := make([]string, 0, len(m))
	for name := range m {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
