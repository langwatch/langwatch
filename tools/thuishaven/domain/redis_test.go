package domain

import "testing"

// Which formula `haven up` starts when nothing answers on the Redis port.
// @scenario "Starting the shared Redis adopts the brew-started formula, else the installed one, valkey first"
func TestChooseRedisFormula(t *testing.T) {
	cases := []struct {
		name      string
		installed map[string]bool
		started   string
		want      string
	}{
		{"a fresh machine gets valkey", nil, "", ValkeyFormula},
		{"a machine with only redis keeps redis", map[string]bool{RedisFormula: true}, "", RedisFormula},
		{"a machine with only valkey uses valkey", map[string]bool{ValkeyFormula: true}, "", ValkeyFormula},
		{"both installed keeps the started redis", map[string]bool{RedisFormula: true, ValkeyFormula: true}, RedisFormula, RedisFormula},
		{"both installed keeps the started valkey", map[string]bool{RedisFormula: true, ValkeyFormula: true}, ValkeyFormula, ValkeyFormula},
		{"both installed, neither started, prefers valkey", map[string]bool{RedisFormula: true, ValkeyFormula: true}, "", ValkeyFormula},
	}
	for _, tc := range cases {
		if got := ChooseRedisFormula(tc.installed, tc.started); got != tc.want {
			t.Errorf("%s: ChooseRedisFormula = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestStartedRedisFormulaReadsBrewServicesList(t *testing.T) {
	cases := map[string]string{
		"Name          Status  User File\npostgresql@16 started lw   ~/x.plist\nredis         started lw   ~/Library/LaunchAgents/sh.brew.redis.plist\n": RedisFormula,
		"Name   Status  User File\nredis  none\nvalkey started lw ~/Library/LaunchAgents/sh.brew.valkey.plist\n":                                         ValkeyFormula,
		"Name   Status  User File\nredis  stopped lw ~/x.plist\nvalkey error  256 lw ~/y.plist\n":                                                        "",
		"Name        Status  User File\nredis-stack started lw ~/x.plist\n":                                                                              "",
		"": "",
	}
	for list, want := range cases {
		if got := StartedRedisFormula(list); got != want {
			t.Errorf("StartedRedisFormula(%q) = %q, want %q", list, got, want)
		}
	}
}

// Valkey reports a redis_version for compatibility, so the health line must
// look at server_name first or every Valkey reads as Redis 7.2.
// @scenario "The Redis health line names the server that answered"
// @scenario "The Redis health line names the server that answered"
func TestRedisServerNameTellsValkeyFromRedis(t *testing.T) {
	valkey := map[string]string{"server_name": "valkey", "valkey_version": "9.1.2", "redis_version": "7.2.4"}
	if got := RedisServerName(valkey); got != "valkey 9.1.2" {
		t.Errorf("valkey INFO named %q", got)
	}
	if got := RedisServerName(map[string]string{"redis_version": "8.2.1"}); got != "redis 8.2.1" {
		t.Errorf("redis INFO named %q", got)
	}
	if got := RedisServerName(map[string]string{}); got != "" {
		t.Errorf("empty INFO named %q", got)
	}
}

func TestValkeyServerCountsAsTheSharedRedisInTheFootprint(t *testing.T) {
	for _, cmd := range []string{"valkey-server *:6379", "/opt/homebrew/opt/valkey/bin/valkey-server 127.0.0.1:6379"} {
		if kind, ok := classifyServer(cmd); !ok || kind != "redis" {
			t.Errorf("classifyServer(%q) = %q, %v; want redis", cmd, kind, ok)
		}
	}
}

// The prerequisite offers valkey first, so a non-interactive run on a fresh
// machine installs it, and an installed redis still satisfies the entry.
// @scenario "Valkey is offered first for the shared Redis"
// @scenario "An installed Redis still satisfies the Redis entry"
func TestRedisPrereqPrefersValkeyAndKeepsAnInstalledRedis(t *testing.T) {
	p, ok := LookupPrereq("redis")
	if !ok {
		t.Fatal("the catalogue lost its redis entry")
	}
	if got := DefaultChoice(p); got != ValkeyFormula {
		t.Errorf("DefaultChoice = %q, want valkey", got)
	}
	for _, c := range p.Candidates {
		if !c.FormulaIsAuthority {
			t.Errorf("candidate %q must be judged by brew, which is what starts it", c.Key)
		}
	}
	for _, have := range RedisFormulas {
		st := prereqProbe{found: map[string]Found{have: {Present: true}}, goos: "darwin"}.plan(p)
		if st.State != PrereqSatisfied || st.Via != have {
			t.Errorf("with %s installed: state %v via %q, want satisfied via %s", have, st.State, st.Via, have)
		}
	}
	if st := (prereqProbe{found: map[string]Found{}, goos: "darwin"}).plan(p); st.State != PrereqMissing {
		t.Errorf("with neither installed: state %v, want missing", st.State)
	}
}
