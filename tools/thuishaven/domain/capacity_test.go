package domain

import (
	"strings"
	"testing"
	"time"
)

// tenCores is the machine the 2026-10-12 report came from: 10 cores, 64 GiB.
var tenCores = CheckMachine{TotalRAMBytes: 64 * checkGiB, NumCPU: 10, Pressure: Green}

func sample(load float64, freeGiB uint64) MachineLoad {
	return MachineLoad{Load1: load, NumCPU: 10, AvailableBytes: freeGiB * checkGiB, TotalBytes: 64 * checkGiB}
}

func TestNextCapacityTier(t *testing.T) {
	cases := []struct {
		name string
		prev CapacityTier
		in   MachineLoad
		want CapacityTier
	}{
		{"a still machine with free memory goes quiet", CapacityNormal, sample(1, 30), CapacityQuiet},
		{"load at the entry line goes quiet", CapacityNormal, sample(3.5, 30), CapacityQuiet},
		{"load inside the band does not enter quiet", CapacityNormal, sample(4.5, 30), CapacityNormal},
		{"load inside the band keeps quiet", CapacityQuiet, sample(4.5, 30), CapacityQuiet},
		{"load at the leave line leaves quiet", CapacityQuiet, sample(6, 30), CapacityNormal},
		{"load 40 is never quiet", CapacityQuiet, sample(40, 30), CapacityNormal},
		{"little free memory does not enter quiet", CapacityNormal, sample(1, 12), CapacityNormal},
		{"free memory inside the band keeps quiet", CapacityQuiet, sample(1, 12), CapacityQuiet},
		{"free memory under a sixth leaves quiet", CapacityQuiet, sample(1, 8), CapacityNormal},
		{"an unreadable load reads normal", CapacityQuiet, sample(-1, 30), CapacityNormal},
		{"no cores reads normal", CapacityQuiet, MachineLoad{Load1: 0, TotalBytes: 1}, CapacityNormal},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := NextCapacityTier(c.prev, c.in); got != c.want {
				t.Fatalf("NextCapacityTier(%s, %+v) = %s, want %s", c.prev, c.in, got, c.want)
			}
		})
	}
}

// @scenario "The capacity tier does not flap"
func TestNextCapacityTierDoesNotFlap(t *testing.T) {
	tier := CapacityNormal
	flips := 0
	for i, load := range []float64{3, 4, 5, 4, 5.5, 4, 5, 3.9, 5.9, 4.2} {
		next := NextCapacityTier(tier, sample(load, 30))
		if i > 0 && next != tier {
			flips++
		}
		tier = next
	}
	if flips != 0 || tier != CapacityQuiet {
		t.Fatalf("a load hovering in the band flipped %d times and ended %s; want 0 flips, quiet", flips, tier)
	}
}

// @scenario "A quiet machine grows the check budget and run widths"
// @scenario "A check gives way to a boot someone is waiting on"
func TestResolveCapacity(t *testing.T) {
	quiet := CapacityReading{Tier: CapacityQuiet, Load1: 1.2, NumCPU: 10}
	busy := CapacityReading{Tier: CapacityNormal, Load1: 40, NumCPU: 10}

	t.Run("a busy machine keeps today's budget", func(t *testing.T) {
		c := ResolveCapacity(CapacityRequest{Machine: tenCores, Reading: busy})
		if c.Units != 8 || c.Tier != CapacityNormal {
			t.Fatalf("got %+v, want 8 units at normal", c)
		}
		if got := c.Describe(); got != "busy, load 40 on 10 cores: 8 units" {
			t.Fatalf("Describe() = %q", got)
		}
	})
	t.Run("a quiet machine grows to every core", func(t *testing.T) {
		c := ResolveCapacity(CapacityRequest{Machine: tenCores, Reading: quiet})
		if c.Units != 10 || c.Headroom != 8 {
			t.Fatalf("got %+v, want 10 units with 8 idle cores", c)
		}
		if got := c.Describe(); got != "quiet, load 1.2 on 10 cores: 10 units" {
			t.Fatalf("Describe() = %q", got)
		}
	})
	t.Run("memory pressure never grows", func(t *testing.T) {
		amber := tenCores
		amber.Pressure = Amber
		c := ResolveCapacity(CapacityRequest{Machine: amber, Reading: quiet})
		if c.Units != 4 || c.Tier != CapacityNormal {
			t.Fatalf("got %+v, want amber's 4 units, not grown", c)
		}
	})
	t.Run("an explicit CHECK_SLOTS is never reshaped", func(t *testing.T) {
		c := ResolveCapacity(CapacityRequest{Machine: tenCores, Env: CheckEnv{CheckSlots: "3"}, Reading: quiet, BootsWaited: 1})
		if c.Units != 6 || c.Background() {
			t.Fatalf("got %+v, want CHECK_SLOTS's 6 units in utility", c)
		}
	})
	t.Run("a waited-on boot halves a check's budget and backgrounds it", func(t *testing.T) {
		c := ResolveCapacity(CapacityRequest{Machine: tenCores, Reading: busy, BootsWaited: 1})
		if c.Units != 4 || c.AgentBand() != BandBackground {
			t.Fatalf("got %+v band %s, want 4 units in the background band", c, c.AgentBand())
		}
		if got := c.Describe(); got != "busy, load 40 on 10 cores: 4 units; a boot is ahead of you" {
			t.Fatalf("Describe() = %q", got)
		}
	})
	t.Run("a boot holds a quiet machine's growth back too", func(t *testing.T) {
		c := ResolveCapacity(CapacityRequest{Machine: tenCores, Reading: quiet, BootsWaited: 2})
		if c.Units != 4 || c.Tier != CapacityNormal || !strings.HasSuffix(c.Describe(), "2 boots are ahead of you") {
			t.Fatalf("got %+v %q", c, c.Describe())
		}
	})
	t.Run("a boot's own run keeps the whole budget and no clamp", func(t *testing.T) {
		c := ResolveCapacity(CapacityRequest{Machine: tenCores, Reading: busy, BootsWaited: 1, BootWork: true})
		if c.Units != 8 || c.AgentBand() != BandDefault {
			t.Fatalf("got %+v band %s, want 8 units unclamped", c, c.AgentBand())
		}
	})
	t.Run("halving never goes below one check", func(t *testing.T) {
		red := tenCores
		red.Pressure = Red
		c := ResolveCapacity(CapacityRequest{Machine: red, Reading: busy, BootsWaited: 1})
		if c.Units != UnitsPerCheck {
			t.Fatalf("got %d units, want %d", c.Units, UnitsPerCheck)
		}
	})
}

func TestCapacityRunUnits(t *testing.T) {
	quiet := ResolveCapacity(CapacityRequest{Machine: tenCores, Reading: CapacityReading{Tier: CapacityQuiet, Load1: 1.2}})
	crowded := ResolveCapacity(CapacityRequest{Machine: tenCores, Reading: CapacityReading{Tier: CapacityQuiet, Load1: 7.5}})
	busy := ResolveCapacity(CapacityRequest{Machine: tenCores, Reading: CapacityReading{Tier: CapacityNormal, Load1: 40}})
	cases := []struct {
		name    string
		c       Capacity
		class   SlotClass
		workers string
		want    int
	}{
		{"busy typecheck keeps two", busy, ClassTypecheck, "", 2},
		{"busy test keeps its four-worker cap", busy, ClassTest, "8", 4},
		{"quiet typecheck doubles", quiet, ClassTypecheck, "", 4},
		{"quiet test doubles its default", quiet, ClassTest, "", 4},
		{"quiet test may take what it asked, up to eight", quiet, ClassTest, "8", 8},
		{"quiet test asking twelve gets eight", quiet, ClassTest, "12", 8},
		{"quiet with two idle cores grows only to them", crowded, ClassTypecheck, "", 2},
		{"the gate off keeps the weight", Capacity{}, ClassTest, "3", 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.c.RunUnits(c.class, c.workers); got != c.want {
				t.Fatalf("RunUnits(%s, %q) = %d, want %d", c.class, c.workers, got, c.want)
			}
		})
	}
}

func TestReadCapacity(t *testing.T) {
	now := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	fresh := PressureRecord{Version: PressureRecordVersion, WrittenAt: now.Add(-10 * time.Second), Capacity: CapacityReading{Tier: CapacityQuiet}}
	if r, ok := ReadCapacity(fresh, true, now); !ok || r.Tier != CapacityQuiet {
		t.Fatalf("a fresh record: got %+v %v", r, ok)
	}
	stale := fresh
	stale.WrittenAt = now.Add(-PressureStaleAfter - time.Second)
	if _, ok := ReadCapacity(stale, true, now); ok {
		t.Fatal("a stale record must not be believed")
	}
	older := fresh
	older.Capacity = CapacityReading{}
	if _, ok := ReadCapacity(older, true, now); ok {
		t.Fatal("a record from a daemon that publishes no tier must read as no reading")
	}
}

func TestBootsWaitedOn(t *testing.T) {
	count, own := BootsWaitedOn([]string{"wt-a", "wt-a", "", "wt-b"}, "wt-b")
	if count != 2 || !own {
		t.Fatalf("got %d, %v; want 2 distinct stacks, own waited on", count, own)
	}
	if _, own := BootsWaitedOn([]string{"wt-a"}, ""); own {
		t.Fatal("a run outside any boot is not boot work")
	}
}

func TestBlockedWaiterGoesFirst(t *testing.T) {
	boot := WaiterState{Caller: SubAgent, Blocked: true}
	person := WaiterState{Caller: Interactive, Waited: time.Hour, OverrideHonored: true}
	if !ShouldYield(person, []WaiterState{boot}) || ShouldYield(boot, []WaiterState{person}) {
		t.Fatalf("a boot's run (%d) must outrank a person who waited an hour with a claim (%d)", boot.Priority(), person.Priority())
	}
}

func TestParseVMStatAvailable(t *testing.T) {
	out := `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   126890.
Pages active:                                1359984.
Pages inactive:                              1356936.
Pages speculative:                              2612.
Pages occupied by compressor:                 127999.`
	got, ok := ParseVMStatAvailable(out)
	if want := uint64(126890+1356936+2612) * 16384; !ok || got != want {
		t.Fatalf("got %d %v, want %d", got, ok, want)
	}
	if _, ok := ParseVMStatAvailable("Pages free: 12."); ok {
		t.Fatal("no page size header is no reading")
	}
}

func TestParseProcLoadavg(t *testing.T) {
	if got := ParseProcLoadavg("0.52 0.58 0.59 1/389 12345\n"); got != 0.52 {
		t.Fatalf("got %v", got)
	}
	if got := ParseProcLoadavg("nope"); got != -1 {
		t.Fatalf("got %v, want -1", got)
	}
}

// The gate resolves the capacity on every heavy tool call (app checkCapacity).
func BenchmarkResolveCapacity(b *testing.B) {
	b.ReportAllocs()
	now := time.Now()
	rec := PressureRecord{Version: PressureRecordVersion, WrittenAt: now, Capacity: CapacityReading{Tier: CapacityQuiet, Load1: 1.2, NumCPU: 10}}
	stacks := []string{"wt-a", "wt-b"}
	for b.Loop() {
		reading, _ := ReadCapacity(rec, true, now)
		boots, _ := BootsWaitedOn(stacks, "")
		c := ResolveCapacity(CapacityRequest{Machine: tenCores, Reading: reading, BootsWaited: boots})
		_ = c.RunUnits(ClassTest, "4")
	}
}

func BenchmarkCapacityDescribe(b *testing.B) {
	b.ReportAllocs()
	c := ResolveCapacity(CapacityRequest{Machine: tenCores, Reading: CapacityReading{Load1: 40}, BootsWaited: 1})
	for b.Loop() {
		_ = c.Describe()
	}
}

func BenchmarkMeasureCapacity(b *testing.B) {
	b.ReportAllocs()
	mem := MemStat{TotalBytes: 64 * checkGiB, AvailableBytes: 30 * checkGiB}
	for b.Loop() {
		_ = MeasureCapacity(CapacityNormal, SampleLoad(3, 10, mem))
	}
}
