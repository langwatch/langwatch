package access

import (
	"fmt"
	"regexp"
	"strings"
)

// Policy is access.yaml's `policy` block: the rules users' own settings, quota
// and grants are checked against. Each list starts from the image's default;
// `add` extends it and `replace` swaps it out. Leave it out to keep the defaults.
type Policy struct {
	GrantPrivileges     ListPolicy `yaml:"grant_privileges"`
	QuotaLimits         ListPolicy `yaml:"quota_limits"`
	ProtectedSettings   ListPolicy `yaml:"protected_settings"`
	RestrictedDatabases ListPolicy `yaml:"restricted_databases"`
}

// ListPolicy adds to or replaces one default list. replace: [] empties it.
type ListPolicy struct {
	Add     []string  `yaml:"add"`
	Replace *[]string `yaml:"replace"`
}

// The image's defaults: what a policy block that is left out means.
var (
	DefaultGrantPrivileges = []string{"SELECT", "SHOW TABLES", "SHOW COLUMNS", "SHOW DICTIONARIES", "dictGet"}
	DefaultQuotaLimits     = []string{
		"queries", "query_selects", "query_inserts", "errors", "result_rows", "result_bytes",
		"read_rows", "read_bytes", "written_bytes", "execution_time", "failed_sequential_authentications",
	}
	// AuditedSettings decide whether a query reaches system.query_log, so by
	// default no tier and no user's own settings may change them.
	AuditedSettings            = []string{"log_queries", "log_queries_min_type", "log_queries_min_query_duration_ms", "log_queries_probability", "log_queries_cut_to_length", "log_profile_events"}
	DefaultRestrictedDatabases = []string{"system", "information_schema", "INFORMATION_SCHEMA"}
)

var (
	privilegeRE  = regexp.MustCompile(`^[A-Za-z][A-Za-z ]{0,62}[A-Za-z]$`)
	quotaLimitRE = regexp.MustCompile(`^[a-z][a-z_]{0,62}$`)
)

func (l ListPolicy) apply(def []string) []string {
	out := def
	if l.Replace != nil {
		out = *l.Replace
	}
	return append(append([]string{}, out...), l.Add...)
}

func (l ListPolicy) entries() []string {
	if l.Replace == nil {
		return l.Add
	}
	return append(append([]string{}, *l.Replace...), l.Add...)
}

// Rules is a Policy resolved against the defaults.
type Rules struct {
	grantRE    *regexp.Regexp
	privileges []string
	quota      map[string]bool
	protected  map[string]bool
	restricted map[string]bool
	cat        Catalogue
	// Protected lists the settings no user may change, in order.
	Protected []string
}

// Rules resolves p against the image's defaults.
func (p Policy) Rules() Rules {
	privileges := p.GrantPrivileges.apply(DefaultGrantPrivileges)
	quoted := make([]string, len(privileges))
	for i, priv := range privileges {
		quoted[i] = regexp.QuoteMeta(priv)
	}
	protected := p.ProtectedSettings.apply(AuditedSettings)
	return Rules{
		// A privilege, an optional column list, ON one database's table or tables.
		grantRE:    regexp.MustCompile(`^(` + strings.Join(quoted, "|") + `)(\([A-Za-z_][A-Za-z0-9_]*(, ?[A-Za-z_][A-Za-z0-9_]*)*\))? ON ([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*|\*)$`),
		privileges: privileges,
		quota:      set(p.QuotaLimits.apply(DefaultQuotaLimits)),
		protected:  set(protected),
		restricted: set(p.RestrictedDatabases.apply(DefaultRestrictedDatabases)),
		Protected:  protected,
	}
}

func set(names []string) map[string]bool {
	m := make(map[string]bool, len(names))
	for _, n := range names {
		m[n] = true
	}
	return m
}

// validate checks the names a policy lists, before they shape any rule.
func (p Policy) validate(cat Catalogue, add func(where, format string, args ...any)) {
	for _, name := range p.ProtectedSettings.entries() {
		if err := cat.checkSettingValue(name, nil); err != nil {
			add("policy.protected_settings", "%v", err)
		}
	}
	for _, priv := range p.GrantPrivileges.entries() {
		if !cat.knowsPrivilege(priv) {
			add("policy.grant_privileges", "%q is not a ClickHouse privilege", priv)
		}
	}
	for _, c := range []struct {
		where string
		list  ListPolicy
		re    *regexp.Regexp
	}{
		{"policy.grant_privileges", p.GrantPrivileges, privilegeRE},
		{"policy.quota_limits", p.QuotaLimits, quotaLimitRE},
		{"policy.protected_settings", p.ProtectedSettings, settingNameRE},
		{"policy.restricted_databases", p.RestrictedDatabases, databaseNameRE},
	} {
		for _, name := range c.list.entries() {
			if !c.re.MatchString(name) {
				add(c.where, "%q must match %s", name, c.re)
			}
		}
	}
	if p.GrantPrivileges.Replace != nil && len(p.GrantPrivileges.apply(nil)) == 0 {
		add("policy.grant_privileges", "replace leaves no privilege; leave grant_privileges out, or name at least one")
	}
}

func (r Rules) describePrivileges() string {
	return fmt.Sprintf("one of %s", strings.Join(r.privileges, ", "))
}
