package logfmt

import "testing"

// TestMuted_DropsThePrismaBanner pins the two lines Prisma prints on every
// generate, dimmed, one of them on stderr, with no flag to turn either off.
//
/** @scenario "The codegen lane prints what a generator did, not what it loaded" */
func TestMuted_DropsThePrismaBanner(t *testing.T) {
	for _, line := range []string{
		"Loaded Prisma config from prisma.config.ts.",
		"\x1b[2mLoaded Prisma config from prisma.config.ts.\x1b[22m",
		"Prisma schema loaded from prisma/schema.prisma",
		"",
		"   ",
	} {
		if !Muted("codegen", line) {
			t.Errorf("Muted(codegen, %q) = false, want true", line)
		}
	}
}

// TestMuted_KeepsWhatTheGeneratorDid pins the line the lane exists to show.
//
/** @scenario "The codegen lane prints what a generator did, not what it loaded" */
func TestMuted_KeepsWhatTheGeneratorDid(t *testing.T) {
	for _, line := range []string{
		"✔ Generated Prisma Client (v7.9.1) to ./src/generated/client in 421ms",
		"Generated 7 setup skill bodies (137 kB)",
		`{"level":"error","msg":"seed failed"}`,
	} {
		if Muted("codegen", line) {
			t.Errorf("Muted(codegen, %q) = true, want false", line)
		}
	}
}

// TestMuted_LeavesServiceLanesAlone pins the scope: a blank line from a
// service is that service's output, not haven's to remove.
//
/** @scenario "The codegen lane prints what a generator did, not what it loaded" */
func TestMuted_LeavesServiceLanesAlone(t *testing.T) {
	for _, lane := range []string{"ui", "api", "workers", "nlp"} {
		if Muted(lane, "") {
			t.Errorf("Muted(%q, blank) = true, want false", lane)
		}
		if Muted(lane, "Prisma schema loaded from prisma/schema.prisma") {
			t.Errorf("Muted(%q, banner) = true, want false", lane)
		}
	}
}
