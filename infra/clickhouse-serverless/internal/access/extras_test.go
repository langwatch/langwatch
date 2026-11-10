package access

import (
	"strings"
	"testing"
)

const opsUser = `
users:
  - name: ops
    tier: read
    databases: [analytics]
    login: {rolling: {dir: /secrets/ops}}
    settings: {max_execution_time: 10, max_result_bytes: 10000000}
    quota: {duration_seconds: 3600, limits: {queries: 600, errors: 50}}
    grants: ["SELECT ON system.query_log", "SELECT(name, engine) ON system.tables"]
`

// @scenario "A user narrows its tier with its own settings and quota, and adds named read grants"
func TestPlan_UserSettingsQuotaAndGrants(t *testing.T) {
	p := Plan(mustParse(t, opsUser), Inputs{Passwords: map[string][]Password{"ops": {{SHA256Hex: sha("pw")}}}}, now)

	user := p.Users["ops"].(map[string]any)
	if user["profile"] != "access_ops" || user["quota"] != "access_ops" {
		t.Errorf("ops profile, quota = %v, %v; want its own", user["profile"], user["quota"])
	}
	profile := p.Profiles["access_ops"].(Profile)
	if profile.Parent != "tier_read" || profile.Settings["max_execution_time"] != 10 {
		t.Errorf("ops profile = %v; want it to inherit tier_read and set its own cap", profile)
	}
	// ClickHouse applies a profile's elements in order: the parent must come first.
	out, err := p.UsersYAML()
	if err != nil {
		t.Fatal(err)
	}
	text := string(out)
	if parent, own := strings.Index(text, "profile: tier_read"), strings.Index(text, "max_execution_time: 10"); parent < 0 || own < parent {
		t.Errorf("access_ops must name its parent before its settings:\n%s", text)
	}
	interval := p.Quotas["access_ops"].(map[string]any)["interval"].(map[string]any)
	if interval["duration"] != 3600 || interval["queries"] != int64(600) {
		t.Errorf("ops quota interval = %v", interval)
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
		{"audited setting", "settings: {log_queries: 0}", "decides what reaches system.query_log"},
		{"readonly off", "settings: {readonly: 0}", "cannot set readonly to 0"},
		{"replaced inheritance", "settings: {profile: default}", `setting "profile" cannot be set here`},
		{"nested value", "settings: {max_threads: [1]}", "must be a single value"},
		{"unknown quota limit", "quota: {duration_seconds: 60, limits: {cpu: 1}}", `quota limit "cpu"`},
		{"no quota duration", "quota: {limits: {queries: 1}}", "duration_seconds must be positive"},
		{"admin grant", `grants: ["ALL ON *.*"]`, "must be SELECT"},
		{"access management", `grants: ["CREATE USER ON *.*"]`, "must be SELECT"},
		{"every database", `grants: ["SELECT ON *.*"]`, "must be SELECT"},
		{"system wildcard", `grants: ["SELECT ON system.*"]`, "must name each system table"},
		{"grant option", `grants: ["SELECT ON d.t WITH GRANT OPTION"]`, "must be SELECT"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(user(tc.extra)))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}
