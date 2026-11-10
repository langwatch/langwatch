package access

import (
	"strings"
	"testing"
)

const monitorUser = `
users:
  - name: monitor
    tier: read
    databases: [analytics]
    login: {rolling: {dir: /secrets/monitor}}
    settings: {max_execution_time: 10, max_result_bytes: 10000000}
    quota: {duration_seconds: 3600, limits: {queries: 600, errors: 50}}
    grants: ["SELECT ON system.query_log", "SELECT(name, engine) ON system.tables"]
`

// @scenario "A user narrows its tier with its own settings and quota, and adds named read grants"
func TestPlan_UserSettingsQuotaAndGrants(t *testing.T) {
	p := Plan(mustParse(t, monitorUser), Inputs{Passwords: map[string][]Password{"monitor": {{SHA256Hex: sha("pw")}}}}, now)

	user := p.Users["monitor"].(map[string]any)
	if user["profile"] != "access_monitor" || user["quota"] != "access_monitor" {
		t.Errorf("monitor profile, quota = %v, %v; want its own", user["profile"], user["quota"])
	}
	profile := p.Profiles["access_monitor"].(Profile)
	if profile.Parent != "tier_read" || profile.Settings["max_execution_time"] != 10 {
		t.Errorf("monitor profile = %v; want it to inherit tier_read and set its own cap", profile)
	}
	// ClickHouse applies a profile's elements in order: the parent must come first.
	out, err := p.UsersYAML()
	if err != nil {
		t.Fatal(err)
	}
	text := string(out)
	if parent, own := strings.Index(text, "profile: tier_read"), strings.Index(text, "max_execution_time: 10"); parent < 0 || own < parent {
		t.Errorf("access_monitor must name its parent before its settings:\n%s", text)
	}
	interval := p.Quotas["access_monitor"].(map[string]any)["interval"].(map[string]any)
	if interval["duration"] != 3600 || interval["queries"] != int64(600) {
		t.Errorf("monitor quota interval = %v", interval)
	}
	grants := strings.Join(user["grants"].(map[string]any)["query"].([]string), "\n")
	for _, want := range []string{"GRANT tier_read", "GRANT SELECT ON `analytics`.*", "GRANT SELECT ON system.query_log", "GRANT SELECT(name, engine) ON system.tables"} {
		if !strings.Contains(grants, want) {
			t.Errorf("grants lack %q:\n%s", want, grants)
		}
	}
	doc, err := p.UsersYAML()
	if err != nil || !strings.Contains(string(doc), "profiles:") || !strings.Contains(string(doc), "quotas:") {
		t.Errorf("users file lacks the profile or quota: %v\n%s", err, doc)
	}
}

// @scenario "A user's own settings, quota and grants cannot widen the tier past its guarantees"
func TestParse_RefusesExtrasThatWidenTheTier(t *testing.T) {
	user := func(extra string) string {
		return "users:\n  - {name: a, tier: read, databases: [d], login: {rolling: {dir: /x}}, " + extra + "}\n"
	}
	for _, tc := range []struct{ name, extra, want string }{
		{"audited setting", "settings: {log_queries: 0}", "is protected by the policy"},
		{"readonly off", "settings: {readonly: 0}", "cannot set readonly to 0"},
		{"replaced inheritance", "settings: {profile: default}", `setting "profile" cannot be set here`},
		{"nested value", "settings: {max_threads: [1]}", "must be a single value"},
		{"unknown quota limit", "quota: {duration_seconds: 60, limits: {cpu: 1}}", `quota limit "cpu"`},
		{"no quota duration", "quota: {limits: {queries: 1}}", "duration_seconds must be positive"},
		{"admin grant", `grants: ["ALL ON *.*"]`, "must be one of SELECT"},
		{"access management", `grants: ["CREATE USER ON *.*"]`, "must be one of SELECT"},
		{"every database", `grants: ["SELECT ON *.*"]`, "must be one of SELECT"},
		{"system wildcard", `grants: ["SELECT ON system.*"]`, "must name each system table"},
		{"grant option", `grants: ["SELECT ON d.t WITH GRANT OPTION"]`, "must be one of SELECT"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(user(tc.extra)))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

// @scenario "An install adds to or replaces the default policy in its access file"
func TestParse_PolicyAddsToOrReplacesTheDefaults(t *testing.T) {
	const added = `policy:
  grant_privileges: {add: ["SYSTEM FLUSH LOGS"]}
  quota_limits: {replace: [queries]}
  protected_settings: {replace: [log_queries]}
  restricted_databases: {add: [secrets]}
users:
  - name: a
    tier: read
    databases: [d]
    login: {rolling: {dir: /x}}
    settings: {log_query_settings: 0}
    quota: {duration_seconds: 60, limits: {queries: 5}}
    grants: ["SYSTEM FLUSH LOGS ON d.t", "SELECT ON d.t"]
`
	f, err := Parse([]byte(added))
	if err != nil {
		t.Fatalf("a policy that widens the defaults was refused: %v", err)
	}
	if got := f.Policy.Rules().Protected; len(got) != 1 || got[0] != "log_queries" {
		t.Errorf("protected settings = %v, want the replacement alone", got)
	}
	for _, tc := range []struct{ name, file, want string }{
		{"replaced quota limits", strings.Replace(added, "{queries: 5}", "{errors: 5}", 1), `quota limit "errors"`},
		{"still protected", strings.Replace(added, "log_query_settings: 0", "log_queries: 0", 1), `setting "log_queries" is protected`},
		{"added restricted database", strings.Replace(added, "databases: [d]", "databases: [secrets]", 1), `database "secrets" cannot be granted`},
		{"no privilege left", strings.Replace(added, `{add: ["SYSTEM FLUSH LOGS"]}`, "{replace: []}", 1), "replace leaves no privilege"},
		{"bad policy name", strings.Replace(added, "[secrets]", `["a;b"]`, 1), "policy.restricted_databases"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Parse([]byte(tc.file)); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

// A rolling user dropped for having no valid password leaves no profile or quota behind.
func TestPlan_DroppedUserLeavesNoProfileOrQuota(t *testing.T) {
	p := Plan(mustParse(t, monitorUser), Inputs{}, now)
	if len(p.Profiles) != 0 || len(p.Quotas) != 0 {
		t.Errorf("profiles %v, quotas %v; want none for a user that cannot log in", p.Profiles, p.Quotas)
	}
}
