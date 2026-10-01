package visualdiff

import (
	"io"
	"testing"
	"time"
)

// @scenario "check runs on as many pages as the machine has room for"
func TestCheckPagesFitTheMachine(t *testing.T) {
	const gib = PageMemory
	cases := []struct {
		name string
		cpus int
		free int64
		want int
	}{
		{"a large idle machine stops at four", 16, 32 * gib, 4},
		{"half the CPUs", 6, 32 * gib, 3},
		{"one page per gigabyte free", 16, 2*gib + gib/2, 2},
		{"never under one", 1, gib / 4, 1},
		{"an unreadable machine gets four", 0, 0, 4},
	}
	for _, tc := range cases {
		if got := CheckPages(tc.cpus, tc.free); got != tc.want {
			t.Errorf("%s: CheckPages(%d, %d) = %d, want %d", tc.name, tc.cpus, tc.free, got, tc.want)
		}
	}
}

// @scenario "check runs on as many pages as the machine has room for"
func TestFreeMemoryIsReadFromVMStatAndMemInfo(t *testing.T) {
	vmStat := "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n" +
		"Pages free:                               1000.\n" +
		"Pages active:                           900000.\n" +
		"Pages inactive:                           2000.\n" +
		"Pages speculative:                         100.\n" +
		"Pages wired down:                       500000.\n"
	if got, want := ParseVMStat(vmStat), int64(3100*16384); got != want {
		t.Errorf("ParseVMStat = %d, want %d", got, want)
	}
	if got := ParseVMStat("garbage"); got != 0 {
		t.Errorf("unreadable vm_stat = %d, want 0", got)
	}
	memInfo := "MemTotal:       32000000 kB\nMemFree:          100000 kB\nMemAvailable:    4000000 kB\n"
	if got, want := ParseMemInfo(memInfo), int64(4000000*1024); got != want {
		t.Errorf("ParseMemInfo = %d, want %d", got, want)
	}
}

// @scenario "check's time left counts only the flows' own pace"
func TestCheckTimeLeftIgnoresTheRoutePass(t *testing.T) {
	progress := &checkProgress{results: newFlowResults(), total: 210, started: time.Now().Add(-16 * time.Minute), out: io.Discard}
	progress.phase(RunnerPhase{Side: "candidate", Name: "recapture"})
	progress.flowsFrom = progress.flowsFrom.Add(-70 * time.Second)
	progress.doneAtFlows = 0
	progress.done = 19
	// r12: 19 of 210 flows done 70s into the flows, 17 minutes after the check began.
	left := progress.left(time.Now())
	if left < 11*time.Minute || left > 12*time.Minute {
		t.Fatalf("left %s, want about 11m45s: the route pass is not the flows' pace", left)
	}
}
