package domain

import (
	"path/filepath"
	"testing"
)

// @scenario "macOS install fetches the native tier and colima stays optional"
func TestNativePinnedBinariesOnMacOS(t *testing.T) {
	home := string(filepath.Separator) + "h"
	bins := NativePinnedBinaries(home, "darwin", "arm64")
	if len(bins) != 4 || bins[0].Name != "clickhouse" || bins[1].Name != "tempo" || bins[2].Name != "alloy" || bins[3].Name != "pyroscope" {
		t.Fatalf("got %+v, want clickhouse, tempo, alloy then pyroscope", bins)
	}
	if want := filepath.Join(home, ClickHouseNativeDir, "bin", ClickHouseNativeVersion, "clickhouse"); bins[0].Dest != want {
		t.Errorf("clickhouse dest %q, want %q", bins[0].Dest, want)
	}
	if bins[1].Artifact.SHA256 == "" || bins[1].Artifact.Member != "tempo" {
		t.Errorf("tempo artifact not pinned: %+v", bins[1].Artifact)
	}
	if bins[2].Artifact.SHA256 == "" || bins[2].Artifact.Member != "alloy-darwin-arm64" {
		t.Errorf("alloy artifact not pinned: %+v", bins[2].Artifact)
	}
	if bins[3].Artifact.SHA256 == "" || bins[3].Artifact.Member != "pyroscope" {
		t.Errorf("pyroscope artifact not pinned: %+v", bins[3].Artifact)
	}
}

// @scenario "Linux install keeps today's catalogue"
func TestNativePinnedBinariesNoneOffMacOS(t *testing.T) {
	if bins := NativePinnedBinaries(string(filepath.Separator)+"h", "linux", "amd64"); len(bins) != 0 {
		t.Fatalf("got %+v, want nothing pinned on linux", bins)
	}
}

// @scenario "A second install run fetches nothing"
func TestMissingPinnedBinariesSkipsWhatIsOnDisk(t *testing.T) {
	home := string(filepath.Separator) + "h"
	bins := NativePinnedBinaries(home, "darwin", "arm64")
	onDisk := map[string]bool{bins[0].Dest: true}
	missing := MissingPinnedBinaries(bins, func(p string) bool { return onDisk[p] })
	if len(missing) != 3 || missing[0].Name != "tempo" || missing[1].Name != "alloy" || missing[2].Name != "pyroscope" {
		t.Fatalf("got %+v, want only tempo, alloy and pyroscope", missing)
	}
	all := MissingPinnedBinaries(bins, func(string) bool { return true })
	if len(all) != 0 {
		t.Fatalf("got %+v, want nothing once all are on disk", all)
	}
}

// @scenario "macOS install fetches the native tier and colima stays optional"
func TestNativeTierPrereqsOnMacOS(t *testing.T) {
	report := PlanPrereqs(map[string]Found{}, nil, "darwin")
	got := map[string]PrereqStatus{}
	for _, st := range report {
		got[st.Key] = st
	}
	for _, key := range []string{"observability", "native-binaries"} {
		st := got[key]
		if st.State != PrereqMissing || st.Requirement != PrereqRecommended {
			t.Errorf("%s: state %s, requirement %s; want missing, recommended", key, st.State, st.Requirement)
		}
	}
	if got["runtime"].Requirement != PrereqOptional {
		t.Errorf("runtime is %s, want optional", got["runtime"].Requirement)
	}
	for _, name := range MissingRequired(report) {
		if name == got["observability"].Name || name == got["native-binaries"].Name || name == got["runtime"].Name {
			t.Errorf("%s is reported required; a missing native-tier part must not fail the run", name)
		}
	}
	c, _ := LookupCandidate(got["observability"].Prereq, "observability")
	if cmd, _ := c.InstallOn("darwin"); cmd != "brew install grafana prometheus loki" {
		t.Errorf("observability installs with %q", cmd)
	}
}

// @scenario "Linux install keeps today's catalogue"
func TestNativeTierPrereqsNotApplicableOffMacOS(t *testing.T) {
	for _, st := range PlanPrereqs(map[string]Found{}, nil, "linux") {
		if (st.Key == "observability" || st.Key == "native-binaries") && st.State != PrereqNotApplicable {
			t.Errorf("%s on linux is %s, want n/a", st.Key, st.State)
		}
	}
}
