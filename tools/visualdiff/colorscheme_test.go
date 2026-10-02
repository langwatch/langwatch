package visualdiff

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestParseColorSchemeReadsLightDarkAndBoth(t *testing.T) {
	for value, want := range map[string]ColorScheme{"": SchemeLight, "light": SchemeLight, "dark": SchemeDark, "both": SchemeBoth} {
		got, err := ParseColorScheme(value)
		if err != nil || got != want {
			t.Errorf("ParseColorScheme(%q) = %q, %v; want %q", value, got, err, want)
		}
	}
	if _, err := ParseColorScheme("sepia"); err == nil {
		t.Error("an unknown scheme should be refused before anything boots")
	}
}

func TestRunFlagsDefaultToLightAndTakeTheColorScheme(t *testing.T) {
	root := writeRepoConfig(t)
	for args, want := range map[string]ColorScheme{"": SchemeLight, "-color-scheme dark": SchemeDark, "-color-scheme both": SchemeBoth} {
		parsed, err := parseRunFlags(append([]string{"-root", root}, strings.Fields(args)...), &bytes.Buffer{})
		if err != nil {
			t.Fatalf("%q: %v", args, err)
		}
		if parsed.options.ColorScheme != want {
			t.Errorf("%q: scheme %q, want %q", args, parsed.options.ColorScheme, want)
		}
	}
	if _, err := parseRunFlags([]string{"-root", root, "-color-scheme", "sepia"}, &bytes.Buffer{}); err == nil {
		t.Error("run should refuse an unknown scheme")
	}
}

func TestCheckFlagsTakeTheColorSchemeIntoThePlan(t *testing.T) {
	root := writeRepoConfig(t)
	parsed, err := parseCheckFlags([]string{"-root", root, "-color-scheme", "dark"}, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	config, err := LoadConfig(root + "/" + ConfigFile)
	if err != nil {
		t.Fatal(err)
	}
	if got := checkPlan(parsed, RunnerSide{Name: "candidate"}, config).ColorScheme; got != SchemeDark {
		t.Errorf("check plan scheme %q, want dark", got)
	}
	if _, err := parseCheckFlags([]string{"-root", root, "-color-scheme", "sepia"}, &bytes.Buffer{}); err == nil {
		t.Error("check should refuse an unknown scheme")
	}
}

func TestRunnerPlanSpellsTheColorSchemeAsTheRunnerReadsIt(t *testing.T) {
	encoded, err := json.Marshal(RunnerPlan{ColorScheme: SchemeBoth})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"colorScheme":"both"`) {
		t.Errorf("plan lacks colorScheme, so the runner captures light only: %s", encoded)
	}
	light, err := json.Marshal(RunnerPlan{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(light), "colorScheme") {
		t.Errorf("a default plan should not name a scheme: %s", light)
	}
}

func TestBaselineKeySeparatesSchemesAndLeavesLightAlone(t *testing.T) {
	root := t.TempDir()
	key := func(scheme ColorScheme) string {
		t.Helper()
		got, err := BaselineKey(baselineKeyInputs{commit: testBaseCommit, edition: EditionEnterprise, config: testConfig(), viewport: Viewport{Width: 1440, Height: 900}, scheme: scheme, root: root})
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if key("") != key(SchemeLight) {
		t.Error("light must keep the key every existing baseline has")
	}
	if key(SchemeDark) == key(SchemeLight) || key(SchemeBoth) == key(SchemeDark) {
		t.Error("each scheme needs its own baseline slot")
	}
}
