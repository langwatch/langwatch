package access

import (
	"fmt"
	"regexp"
	"sort"

	"gopkg.in/yaml.v3"
)

// AuditedSettings decide whether a query reaches system.query_log. No tier and
// no per-user settings may change them: a session that did could hide its queries.
var AuditedSettings = []string{
	"log_queries",
	"log_queries_min_type",
	"log_queries_min_query_duration_ms",
	"log_queries_probability",
	"log_queries_cut_to_length",
	"log_query_settings",
	"log_profile_events",
}

// Profile renders its parent first. ClickHouse applies a profile's elements in
// order, so a parent listed after a setting would override that setting.
type Profile struct {
	Parent   string
	Settings map[string]any
}

// MarshalYAML writes `profile: <parent>`, then the settings sorted by name.
func (p Profile) MarshalYAML() (any, error) {
	names := make([]string, 0, len(p.Settings))
	for name := range p.Settings {
		names = append(names, name)
	}
	sort.Strings(names)
	n := &yaml.Node{Kind: yaml.MappingNode}
	for _, kv := range append([][2]any{{"profile", p.Parent}}, pairs(names, p.Settings)...) {
		var key, value yaml.Node
		if err := key.Encode(kv[0]); err != nil {
			return nil, err
		}
		if err := value.Encode(kv[1]); err != nil {
			return nil, err
		}
		n.Content = append(n.Content, &key, &value)
	}
	return n, nil
}

func pairs(names []string, m map[string]any) [][2]any {
	out := make([][2]any, 0, len(names))
	for _, name := range names {
		out = append(out, [2]any{name, m[name]})
	}
	return out
}

// Quota is one rolling interval of limits, rendered as the user's own quota.
type Quota struct {
	DurationSeconds int              `yaml:"duration_seconds"`
	Limits          map[string]int64 `yaml:"limits"`
}

var (
	settingNameRE = regexp.MustCompile(`^[a-z][a-z0-9_]{0,99}$`)
	// A privilege a reading tool needs, ON one database's table or tables. Column
	// lists are plain names; anything else (ALL, ACCESS MANAGEMENT, *.*) is refused.
	grantRE     = regexp.MustCompile(`^(SELECT(\([A-Za-z_][A-Za-z0-9_]*(, ?[A-Za-z_][A-Za-z0-9_]*)*\))?|SHOW TABLES|SHOW COLUMNS|SHOW DICTIONARIES|dictGet) ON ([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*|\*)$`)
	quotaLimits = map[string]bool{
		"queries": true, "query_selects": true, "query_inserts": true, "errors": true,
		"result_rows": true, "result_bytes": true, "read_rows": true, "read_bytes": true,
		"written_bytes": true, "execution_time": true, "failed_sequential_authentications": true,
	}
	// Keys that would replace the inheritance or the constraints the tier sets.
	reservedSettings = map[string]bool{"profile": true, "constraints": true}
)

// ProfileName and QuotaName are what a user's own settings and quota render as.
func ProfileName(user string) string { return "access_" + user }
func QuotaName(user string) string   { return "access_" + user }

// checkExtras validates a user's settings, quota and extra grants.
func checkExtras(u User, add func(where, format string, args ...any), where string) {
	for name, value := range u.Settings {
		checkSetting(u, name, value, add, where)
	}
	if q := u.Quota; q != nil {
		if q.DurationSeconds <= 0 {
			add(where, "quota.duration_seconds must be positive")
		}
		for name, limit := range q.Limits {
			if !quotaLimits[name] || limit < 0 {
				add(where, "quota limit %q is not a known non-negative limit", name)
			}
		}
	}
	for _, g := range u.Grants {
		checkGrant(g, add, where)
	}
}

func checkSetting(u User, name string, value any, add func(where, format string, args ...any), where string) {
	switch {
	case !settingNameRE.MatchString(name) || reservedSettings[name]:
		add(where, "setting %q cannot be set here", name)
	case isAudited(name):
		add(where, "setting %q decides what reaches system.query_log and cannot be changed", name)
	case name == "readonly" && u.Tier.ReadOnly() && fmt.Sprint(value) == "0":
		add(where, "a %s user cannot set readonly to 0", u.Tier)
	}
	switch value.(type) {
	case string, int, float64, bool:
	default:
		add(where, "setting %q must be a single value", name)
	}
}

func checkGrant(g string, add func(where, format string, args ...any), where string) {
	m := grantRE.FindStringSubmatch(g)
	if m == nil {
		add(where, "grant %q must be SELECT, SHOW TABLES, SHOW COLUMNS, SHOW DICTIONARIES or dictGet ON <database>.<table>", g)
		return
	}
	// A wildcard over system would open query text and other users' metadata.
	if forbiddenDatabases[m[4]] && m[5] == "*" {
		add(where, "grant %q must name each %s table", g, m[4])
	}
}

func isAudited(name string) bool {
	for _, a := range AuditedSettings {
		if a == name {
			return true
		}
	}
	return false
}

// planExtras adds the user's own profile and quota to p, and its grants to user.
func planExtras(p *Planned, u User, user map[string]any) {
	if len(u.Settings) > 0 {
		p.Profiles[ProfileName(u.Name)] = Profile{Parent: u.Tier.Name(), Settings: u.Settings}
		user["profile"] = ProfileName(u.Name)
	}
	if q := u.Quota; q != nil {
		interval := map[string]any{"duration": q.DurationSeconds}
		for name, limit := range q.Limits {
			interval[name] = limit
		}
		p.Quotas[QuotaName(u.Name)] = map[string]any{"interval": interval}
		user["quota"] = QuotaName(u.Name)
	}
	grants := u.Tier.UserGrants(u.Databases)
	for _, g := range u.Grants {
		grants = append(grants, "GRANT "+g)
	}
	user["grants"] = map[string]any{"query": grants}
}
