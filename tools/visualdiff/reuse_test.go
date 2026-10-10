package visualdiff

import "testing"

func TestCodeEntriesLeaveOutWhatNoBuildReads(t *testing.T) {
	top := []string{"a apps", "b modules", "c services", "d specs", "e tools", "f README.md", "g pnpm-lock.yaml", "h dev"}
	services := []string{"j services/langevals/ts-integration", "k services/langyworker"}
	got := CodeEntries(top, services)
	want := []string{"a apps", "b modules", "g pnpm-lock.yaml", "h dev", "j services/langevals/ts-integration", "k services/langyworker"}
	if !equalStrings(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
