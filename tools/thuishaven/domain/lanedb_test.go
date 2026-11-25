package domain

import "testing"

func TestLaneDatabaseEnv(t *testing.T) {
	got := valueOf(LaneDatabaseEnv([]string{"A=1", "DATABASE_URL=postgresql://u:p@127.0.0.1:5432/lw_x"}, "api"), "DATABASE_URL")
	want := "postgresql://u:p@127.0.0.1:5432/lw_x?application_name=api&connection_limit=4"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	kept := LaneDatabaseEnv([]string{"DATABASE_URL=postgresql://u:p@h/d?application_name=x&connection_limit=9"}, "api")
	if v := valueOf(kept, "DATABASE_URL"); v != "postgresql://u:p@h/d?application_name=x&connection_limit=9" {
		t.Errorf("explicit params overwritten: %q", v)
	}
	if len(LaneDatabaseEnv([]string{"A=1"}, "api")) != 1 {
		t.Error("env without DATABASE_URL must pass through")
	}
}
