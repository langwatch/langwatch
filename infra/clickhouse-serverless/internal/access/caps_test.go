package access

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

const cappedUser = `
users:
  - name: monitor
    tier: read
    databases: [analytics]
    login: {rolling: {dir: /secrets/monitor}}
    settings: {max_execution_time: 10}
    caps: {max_execution_time: 30, max_result_bytes: 10000000, max_rows_to_read: 1000000}
`

var monitorPasswords = Inputs{Passwords: map[string][]Password{"monitor": {{SHA256Hex: sha("pw")}}}}

// renderedConstraints reads back the user's own profile as ClickHouse would.
func renderedConstraints(t *testing.T, p Planned, user string) (map[string]any, map[string]Constraint) {
	t.Helper()
	out, err := p.UsersYAML()
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Profiles map[string]map[string]any `yaml:"profiles"`
	}
	if err := yaml.Unmarshal(out, &doc); err != nil {
		t.Fatal(err)
	}
	profile := doc.Profiles[ProfileName(user)]
	raw, _ := profile["constraints"].(map[string]any)
	constraints := map[string]Constraint{}
	for name, c := range raw {
		body, _ := c.(map[string]any)
		constraints[name] = parseConstraint(body)
	}
	return profile, constraints
}

// @scenario "A user's own cap renders as a constraint in its own profile"
func TestPlan_CapRendersAsAConstraint(t *testing.T) {
	p := Plan(mustParse(t, cappedUser), monitorPasswords, now)
	if got := plannedUser(t, p, "monitor")["profile"]; got != "access_monitor" {
		t.Fatalf("monitor profile = %v, want its own", got)
	}
	profile, constraints := renderedConstraints(t, p, "monitor")
	if profile["profile"] != "tier_read" {
		t.Errorf("access_monitor inherits %v, want tier_read", profile["profile"])
	}
	for name, want := range map[string]int{"max_execution_time": 10, "max_result_bytes": 10000000, "max_rows_to_read": 1000000} {
		if profile[name] != want {
			t.Errorf("%s = %v, want %d (a lower own setting stays, else the cap)", name, profile[name], want)
		}
	}
	for name, limit := range map[string]float64{"max_execution_time": 30, "max_result_bytes": 10000000, "max_rows_to_read": 1000000} {
		c, ok := constraints[name]
		if !ok || c.Const || c.Min == nil || *c.Min != 1 || c.Max == nil || *c.Max != limit {
			t.Errorf("%s constraint = %+v, want min 1, max %v", name, c, limit)
		}
	}

	t.Run("the floor follows a rendered floor above 1", func(t *testing.T) {
		five := 5.0
		in := monitorPasswords
		in.Constraints = Constraints{"tier_read": {"max_rows_to_read": {Min: &five}}}
		_, constraints := renderedConstraints(t, Plan(mustParse(t, cappedUser), in, now), "monitor")
		if c := constraints["max_rows_to_read"]; c.Min == nil || *c.Min != 5 {
			t.Errorf("max_rows_to_read floor = %+v, want the tier's 5", c)
		}
	})
}

// @scenario "A user cannot raise its own cap"
func TestPlan_UserCannotRaiseItsCap(t *testing.T) {
	_, constraints := renderedConstraints(t, Plan(mustParse(t, cappedUser), monitorPasswords, now), "monitor")
	c := constraints["max_rows_to_read"]
	// checkConstraint mirrors what ClickHouse checks on SET and query settings.
	for _, raise := range []any{1000001, 0} {
		if checkConstraint("max_rows_to_read", raise, c) == "" {
			t.Errorf("SET max_rows_to_read = %v was allowed past the cap", raise)
		}
	}
	for _, lower := range []any{1, 1000000} {
		if v := checkConstraint("max_rows_to_read", lower, c); v != "" {
			t.Errorf("SET max_rows_to_read = %v refused: %s", lower, v)
		}
	}
}

// @scenario "A cap the image cannot render is refused"
func TestParse_RefusesCapsTheImageCannotRender(t *testing.T) {
	user := func(extra string) string {
		return "users:\n  - {name: a, tier: read, databases: [d], login: {rolling: {dir: /x}}, " + extra + "}\n"
	}
	for _, tc := range []struct{ name, extra, want string }{
		{"not cappable", "caps: {max_threads: 4}", "caps.max_threads cannot be capped"},
		{"zero is no limit", "caps: {max_rows_to_read: 0}", "caps.max_rows_to_read must be above 0"},
		{"negative", "caps: {max_rows_to_read: -1}", "caps.max_rows_to_read must be above 0"},
		{"not a number", "caps: {max_execution_time: 30s}", "a cap must be a whole number"},
		{"a fraction", "caps: {max_execution_time: 2.9}", "a cap must be a whole number"},
		{"own setting above the cap", "settings: {max_rows_to_read: 20}, caps: {max_rows_to_read: 10}", `"max_rows_to_read" = 20 must be a number from 1 to the user's own cap of 10`},
		{"own setting of 0", "settings: {max_rows_to_read: 0}, caps: {max_rows_to_read: 10}", "own cap of 10"},
		{"own setting not a number", `settings: {max_rows_to_read: "5"}, caps: {max_rows_to_read: 10}`, "own cap of 10"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(user(tc.extra)))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
	t.Run("protected by the policy", func(t *testing.T) {
		file := "policy: {protected_settings: {add: [max_execution_time]}}\n" + user("caps: {max_execution_time: 10}")
		if _, err := Parse([]byte(file)); err == nil || !strings.Contains(err.Error(), "caps.max_execution_time is protected") {
			t.Errorf("err = %v, want the protected setting refused", err)
		}
	})
}

// @scenario "A cap looser than its tier is refused, naming the user"
func TestCheckCaps_RefusesACapLooserThanItsTier(t *testing.T) {
	usersD := t.TempDir()
	writeFiles(t, usersD, map[string]string{
		ProfilesFileName: "profiles:\n  default:\n    constraints:\n      max_result_bytes: {min: 1, max: 5000}\n      log_queries: {const: ''}\n",
		TiersFileName:    "profiles:\n  tier_read:\n    constraints:\n      max_execution_time: {min: 1, max: 300}\n",
	})
	file := func(tier, caps string) *File {
		dbs := "databases: [d], "
		if tier == "admin" {
			dbs = ""
		}
		return mustParse(t, "users:\n  - {name: monitor, tier: "+tier+", "+dbs+"login: {rolling: {dir: /x}}, caps: "+caps+"}\n")
	}
	for _, tc := range []struct{ name, tier, caps, want string }{
		{"above the tier", "read", "{max_execution_time: 600}", `users "monitor": caps.max_execution_time = 600 is above the limit of 300 in profile tier_read`},
		{"above the default profile", "write", "{max_result_bytes: 6000}", `users "monitor": caps.max_result_bytes = 6000 is above the limit of 5000 in profile default`},
		{"at the tier", "read", "{max_execution_time: 300}", ""},
		{"no limit on the tier", "write", "{max_execution_time: 100000}", ""},
		{"nothing rendered", "admin", "{max_rows_to_read: 1000000000000}", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := CheckCaps(file(tc.tier, tc.caps), usersD)
			if (tc.want == "") != (err == nil) || (err != nil && !strings.Contains(err.Error(), tc.want)) {
				t.Errorf("CheckCaps = %v, want %q", err, tc.want)
			}
		})
	}

	t.Run("a refused cap is never clamped into the users file", func(t *testing.T) {
		if _, _, err := Render(file("read", "{max_execution_time: 600}"), Inputs{}, now, usersD); err == nil {
			t.Fatal("Render wrote a cap above its tier")
		}
		if _, err := os.Stat(filepath.Join(usersD, UsersFileName)); !errors.Is(err, fs.ErrNotExist) {
			t.Errorf("a users file was written for a refused cap: %v", err)
		}
	})
}

// @scenario "The sidecar keeps the last good users when an edit loosens a tier with a cap"
func TestSyncer_KeepsTheLastGoodUsersWhenACapLoosensATier(t *testing.T) {
	fx := newSyncFixture(t)
	writeFiles(t, fx.syncer.UsersD, map[string]string{
		TiersFileName: "profiles:\n  tier_read:\n    constraints:\n      max_execution_time: {min: 1, max: 300}\n",
	})
	writeFiles(t, fx.secrets, map[string]string{
		"leaving":             "leaving-password-0123",
		"leaving.valid_until": now.Add(time.Minute).Format(time.RFC3339),
	})
	fx.syncer.Sync()
	if !strings.Contains(fx.rendered(), sha("leaving-password-0123")) {
		t.Fatal("the password was not rendered before its valid_until")
	}

	loads := fx.loads
	fx.writeAccess("users:\n  - {name: dashboards, tier: read, databases: [analytics], login: {rolling: {dir: " + fx.secrets + "}}, caps: {max_execution_time: 600}}\n")
	fx.syncer.Now = func() time.Time { return now.Add(2 * time.Minute) }
	fx.syncer.Sync()
	got := fx.rendered()
	if strings.Contains(got, "max_execution_time") || fx.loads != loads {
		t.Errorf("an edit with a cap above its tier was applied:\n%s", got)
	}
	if strings.Contains(got, sha("leaving-password-0123")) || !strings.Contains(got, sha("current-password-0123")) {
		t.Errorf("the last good file was not re-planned while the edit was refused:\n%s", got)
	}
	refused := fx.logs.FilterMessage("access file not applied, keeping the last good one").All()
	if len(refused) == 0 || !strings.Contains(refused[0].ContextMap()["error"].(string), `users "dashboards": caps.max_execution_time = 600`) {
		t.Errorf("the refusal was not logged naming the user and cap: %+v", refused)
	}
}

// @scenario "An access file without caps renders as it did before caps existed"
func TestPlan_WithoutCapsRendersAsBefore(t *testing.T) {
	// Captured from the image before caps existed.
	before := "profiles:\n" +
		"    access_monitor:\n" +
		"        profile: tier_read\n" +
		"        max_execution_time: 10\n" +
		"        max_result_bytes: 10000000\n" +
		"quotas:\n" +
		"    access_monitor:\n" +
		"        interval:\n" +
		"            duration: 3600\n" +
		"            errors: 50\n" +
		"            queries: 600\n" +
		"users:\n" +
		"    monitor:\n" +
		"        auth_methods:\n" +
		"            password_1:\n" +
		"                password_sha256_hex: " + sha("pw") + "\n" +
		"        grants:\n" +
		"            query:\n" +
		"                - GRANT tier_read\n" +
		"                - GRANT SELECT ON `analytics`.*\n" +
		"                - GRANT SELECT ON system.query_log\n" +
		"                - GRANT SELECT(name, engine) ON system.tables\n" +
		"        networks:\n" +
		"            ip:\n" +
		"                - ::/0\n" +
		"        profile: access_monitor\n" +
		"        quota: access_monitor\n"
	out, err := Plan(mustParse(t, monitorUser), monitorPasswords, now).UsersYAML()
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != before {
		t.Errorf("a file without caps renders differently:\n%s", out)
	}
}

// @scenario "A cap the image cannot render is refused"
func TestCheckCaps_RefusesACapTheServerWouldReject(t *testing.T) {
	r := Policy{}.Rules()
	r.cat = Catalogue{settings: map[string]string{"max_execution_time": "Seconds"}}
	// Stands in for clickhouse local: the server refuses a time past Int64 microseconds.
	parsed := checkWithServerParser
	t.Cleanup(func() { checkWithServerParser = parsed })
	checkWithServerParser = func(name, value string) error {
		if value == "10000000000000" {
			return fmt.Errorf("setting %q = %q is refused by ClickHouse", name, value)
		}
		return nil
	}
	for value, want := range map[Cap]string{10000000000000: "caps.max_execution_time: setting", 10: ""} {
		var got []string
		checkCaps(User{Caps: map[string]Cap{"max_execution_time": value}}, r, func(_, format string, args ...any) {
			got = append(got, fmt.Sprintf(format, args...))
		}, "u")
		if joined := strings.Join(got, "; "); (want == "") != (joined == "") || !strings.Contains(joined, want) {
			t.Errorf("cap %d: got %q, want %q", value, joined, want)
		}
	}
}
