package domain

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// repoRoot is the checkout this package sits in, where dev/tests/modes lives.
var repoRoot = filepath.Join("..", "..", "..")

func noShell(string) (string, bool) { return "", false }

// @scenario "Each mode resolves to a named set of env values"
func TestDeploymentModeResolvesToNamedEnv(t *testing.T) {
	mode, err := LoadDeploymentMode(repoRoot, "saas")
	if err != nil {
		t.Fatal(err)
	}
	env := EnvMap(mode.Env)
	if env["IS_SAAS"] != "true" || env["LANGWATCH_DEPLOYMENT_MODE"] != "saas" {
		t.Fatalf("saas env = %v", mode.Env)
	}
	for _, name := range []string{"saas", "hybrid-dp", "sh-free", "sh-licensed", "sh-connected", "sh-instance-idp"} {
		m, err := LoadDeploymentMode(repoRoot, name)
		if err != nil || EnvMap(m.Env)["LANGWATCH_DEPLOYMENT_MODE"] != name {
			t.Errorf("mode %s: %v %v", name, err, m.Env)
		}
	}
}

// @scenario "A licensed mode names what the developer must supply"
func TestLicensedModeRequiresKeyAndCommitsNone(t *testing.T) {
	mode, err := LoadDeploymentMode(repoRoot, "sh-licensed")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(mode.Requires, "LANGWATCH_LICENSE_KEY") {
		t.Fatalf("requires = %v", mode.Requires)
	}
	if _, committed := EnvMap(mode.Env)["LANGWATCH_LICENSE_KEY"]; committed {
		t.Fatal("the key value is committed in the mode file")
	}
}

// @scenario "A mode is refused when a value it requires is not supplied"
func TestMissingRequiredValueIsNamed(t *testing.T) {
	mode := DeploymentMode{Name: "sh-licensed", Requires: []string{"LANGWATCH_LICENSE_KEY"}}
	if got := mode.Missing(noShell, map[string]string{}); !slices.Equal(got, []string{"LANGWATCH_LICENSE_KEY"}) {
		t.Fatalf("missing = %v", got)
	}
	if got := mode.Missing(noShell, map[string]string{"LANGWATCH_LICENSE_KEY": "x"}); len(got) != 0 {
		t.Fatalf("supplied by .env, still missing %v", got)
	}
}

// @scenario "An unknown mode is refused listing the valid ones"
func TestUnknownModeListsValidOnes(t *testing.T) {
	for _, name := range []string{"cloud", "", "../saas"} {
		_, err := LoadDeploymentMode(repoRoot, name)
		if err == nil || !strings.Contains(err.Error(), "saas, sh-connected, sh-free") {
			t.Fatalf("mode %q: err = %v", name, err)
		}
	}
}

// @scenario "haven up --mode applies the mode on top of the overlay"
func TestModeEnvIsAppendedLastToOverlay(t *testing.T) {
	env := Stack{ModeEnv: []string{"IS_SAAS=false"}}.OverlayEnv()
	if env[len(env)-1] != "IS_SAAS=false" {
		t.Fatalf("mode env is not last: %v", env[len(env)-1])
	}
}

// @scenario "haven says which variable wins when the root .env overrides a mode variable"
func TestDotenvOverrideIsNamed(t *testing.T) {
	mode := DeploymentMode{Name: "saas", Env: []string{"IS_SAAS=true", "LANGWATCH_DEPLOYMENT_MODE=saas"}}
	over := mode.OverriddenBy(map[string]string{"IS_SAAS": "false", "LANGWATCH_DEPLOYMENT_MODE": "saas"})
	if !slices.Equal(over, []string{"IS_SAAS"}) {
		t.Fatalf("overridden by %v", over)
	}
	if got := EffectiveMode("saas", over); got != "saas (overridden by .env: IS_SAAS)" {
		t.Fatalf("effective = %q", got)
	}
	if got := EffectiveMode("saas", nil); got != "saas" {
		t.Fatalf("effective = %q", got)
	}
}
