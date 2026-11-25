package domain

import "testing"

func TestFillStackCredentialsMintsOnlyWhatIsMissing(t *testing.T) {
	filled, added, err := FillStackCredentials(map[string]string{"NEXTAUTH_SECRET": "kept"})
	if err != nil || !added {
		t.Fatalf("FillStackCredentials() added=%v err=%v, want new values", added, err)
	}
	if filled["NEXTAUTH_SECRET"] != "kept" {
		t.Fatal("an existing credential must survive, or a restart re-keys the stack")
	}
	for _, credential := range StackCredentials[1:] {
		if len(filled[credential.Key]) != 64 {
			t.Fatalf("%s = %d hex chars, want 64", credential.Key, len(filled[credential.Key]))
		}
	}
	if _, again, _ := FillStackCredentials(filled); again {
		t.Fatal("a complete set must not be rewritten")
	}
}

func TestStackCredentialsEnvLeavesTheDevelopersChoicesAlone(t *testing.T) {
	stored, _, _ := FillStackCredentials(map[string]string{})
	all := EnvMap(StackCredentialsEnv(stored, map[string]string{}))
	if len(all) != len(StackCredentials) {
		t.Fatalf("with nothing set, injected %d, want every credential", len(all))
	}
	withSession := EnvMap(StackCredentialsEnv(stored, map[string]string{"NEXTAUTH_SECRET": "mine"}))
	if _, ok := withSession["NEXTAUTH_SECRET"]; ok {
		t.Fatal("a developer's NEXTAUTH_SECRET must not be overridden")
	}
	if _, ok := withSession["CREDENTIALS_SECRET"]; ok {
		t.Fatal("CREDENTIALS_SECRET yields to a developer's NEXTAUTH_SECRET, which already seals their rows")
	}
	if withSession["HAVEN_SEED_SCIM_TOKEN"] != stored["HAVEN_SEED_SCIM_TOKEN"] {
		t.Fatal("unrelated credentials are still injected")
	}
}
