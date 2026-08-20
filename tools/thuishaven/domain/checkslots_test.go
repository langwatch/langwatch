package domain

import "testing"

const checkGiB = uint64(1) << 30

// @scenario "haven derives the same limit the JavaScript queue would"
func TestResolveCheckSlots(t *testing.T) {
	t.Run("given no explicit limit on a developer machine", func(t *testing.T) {
		cases := []struct {
			name string
			ram  uint64
			cpus int
			want int
		}{
			{"18 GiB / 11 cores: memory allows 3, cores allow 2", 18 * checkGiB, 11, 2},
			{"64 GiB / 16 cores: memory allows 10, cores allow 4", 64 * checkGiB, 16, 4},
			{"a small machine never resolves below one", 4 * checkGiB, 2, 1},
		}
		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				slots, source := ResolveCheckSlots(CheckMachine{TotalRAMBytes: c.ram, NumCPU: c.cpus, Pressure: Green}, CheckEnv{})
				if slots != c.want || source != "machine" {
					t.Fatalf("got %d from %q, want %d from machine", slots, source, c.want)
				}
			})
		}
	})

	t.Run("given an explicit CHECK_SLOTS", func(t *testing.T) {
		if slots, source := ResolveCheckSlots(CheckMachine{TotalRAMBytes: 18 * checkGiB, NumCPU: 11, Pressure: Green}, CheckEnv{CheckSlots: "5", CI: "true"}); slots != 5 || source != "CHECK_SLOTS" {
			t.Fatalf("an explicit limit must win, even under CI: got %d from %q", slots, source)
		}
		if slots, _ := ResolveCheckSlots(CheckMachine{TotalRAMBytes: 18 * checkGiB, NumCPU: 11, Pressure: Green}, CheckEnv{CheckSlots: "off", CI: ""}); slots != 0 {
			t.Fatalf("off must disable the gate, got %d", slots)
		}
		if slots, source := ResolveCheckSlots(CheckMachine{TotalRAMBytes: 18 * checkGiB, NumCPU: 11, Pressure: Green}, CheckEnv{CheckSlots: "bananas", CI: ""}); slots != 2 || source != "machine" {
			t.Fatalf("a typo must fall back to the derived limit, got %d from %q", slots, source)
		}
	})

	t.Run("given CI without an explicit limit", func(t *testing.T) {
		if slots, source := ResolveCheckSlots(CheckMachine{TotalRAMBytes: 18 * checkGiB, NumCPU: 11, Pressure: Green}, CheckEnv{CheckSlots: "", CI: "true"}); slots != 0 || source != "CI" {
			t.Fatalf("CI must not queue, got %d from %q", slots, source)
		}
		if slots, _ := ResolveCheckSlots(CheckMachine{TotalRAMBytes: 18 * checkGiB, NumCPU: 11, Pressure: Green}, CheckEnv{CheckSlots: "", CI: "false"}); slots != 2 {
			t.Fatalf("CI=false is not CI, got %d", slots)
		}
	})

	// @scenario "Memory pressure narrows the queue to one run"
	t.Run("given a machine under memory pressure", func(t *testing.T) {
		for _, level := range []Pressure{Amber, Red} {
			if slots, source := ResolveCheckSlots(CheckMachine{TotalRAMBytes: 64 * checkGiB, NumCPU: 16, Pressure: level}, CheckEnv{}); slots != 1 || source != "pressure" {
				t.Fatalf("under %s the derived limit must narrow to 1, got %d from %q", level, slots, source)
			}
		}
		if slots, source := ResolveCheckSlots(CheckMachine{TotalRAMBytes: 64 * checkGiB, NumCPU: 16, Pressure: Red}, CheckEnv{CheckSlots: "3"}); slots != 3 || source != "CHECK_SLOTS" {
			t.Fatalf("an explicit limit must still win under pressure, got %d from %q", slots, source)
		}
		if slots, source := ResolveCheckSlots(CheckMachine{TotalRAMBytes: 64 * checkGiB, NumCPU: 16, Pressure: Red}, CheckEnv{CI: "true"}); slots != 0 || source != "CI" {
			t.Fatalf("CI must stay unqueued under pressure, got %d from %q", slots, source)
		}
	})
}

// @scenario "A forced pressure level overrides the measurement"
// @scenario "CI keeps the runtime limits it had before the pressure policy"
func TestResolveCheckPressure(t *testing.T) {
	t.Run("given an explicit CHECK_PRESSURE", func(t *testing.T) {
		if got := ResolveCheckPressure("green", Red, ""); got != Green {
			t.Fatalf("green must override a red measurement, got %s", got)
		}
		if got := ResolveCheckPressure("RED", Green, ""); got != Red {
			t.Fatalf("red must override in any case, got %s", got)
		}
		if got := ResolveCheckPressure(" amber ", Green, ""); got != Amber {
			t.Fatalf("surrounding spaces must not matter, got %s", got)
		}
	})

	t.Run("given no or a misspelled override", func(t *testing.T) {
		if got := ResolveCheckPressure("", Amber, ""); got != Amber {
			t.Fatalf("empty must fall back to the measurement, got %s", got)
		}
		if got := ResolveCheckPressure("bananas", Red, ""); got != Red {
			t.Fatalf("a typo must fall back to the measurement, got %s", got)
		}
	})

	t.Run("given CI", func(t *testing.T) {
		for _, ci := range []string{"true", "1", "TRUE", " true "} {
			if got := ResolveCheckPressure("", Red, ci); got != Green {
				t.Fatalf("CI=%q must read green, got %s", ci, got)
			}
		}
		for _, notCI := range []string{"", "0", "false", "FALSE", "  "} {
			if got := ResolveCheckPressure("", Red, notCI); got != Red {
				t.Fatalf("CI=%q is not CI and must keep the measurement, got %s", notCI, got)
			}
		}
		if got := ResolveCheckPressure("red", Green, "true"); got != Red {
			t.Fatalf("an explicit level must win even under CI, got %s", got)
		}
	})
}

func TestCheckGoMemLimit(t *testing.T) {
	// @scenario "The soft cap stays inside what a run can meet"
	t.Run("half the machine, clamped to three and six gibibytes", func(t *testing.T) {
		for ram, want := range map[uint64]string{
			4 * checkGiB:  "3GiB",
			8 * checkGiB:  "4GiB",
			18 * checkGiB: "6GiB",
			64 * checkGiB: "6GiB",
		} {
			if got := CheckGoMemLimit(ram, "", Green); got != want {
				t.Fatalf("CheckGoMemLimit(%d) = %q, want %q", ram, got, want)
			}
		}
	})

	t.Run("an operator's explicit limit always wins", func(t *testing.T) {
		if got := CheckGoMemLimit(18*checkGiB, "2GiB", Green); got != "2GiB" {
			t.Fatalf("got %q, want the operator's 2GiB", got)
		}
		if got := CheckGoMemLimit(18*checkGiB, "8GiB", Red); got != "8GiB" {
			t.Fatalf("got %q, want the operator's 8GiB even under pressure", got)
		}
	})

	// @scenario "Memory pressure lowers the memory ceiling to the floor"
	t.Run("a pressured machine gets the floor whatever its size", func(t *testing.T) {
		for _, level := range []Pressure{Amber, Red} {
			if got := CheckGoMemLimit(64*checkGiB, "", level); got != "3GiB" {
				t.Fatalf("under %s a 64 GiB machine must still resolve the floor, got %q", level, got)
			}
		}
	})
}

// @scenario "Memory pressure halves the compiler's parallelism"
func TestCheckGoMaxProcs(t *testing.T) {
	t.Run("a green machine sets nothing", func(t *testing.T) {
		if got := CheckGoMaxProcs(11, "", Green); got != "" {
			t.Fatalf("green must leave GOMAXPROCS unset, got %q", got)
		}
	})

	t.Run("a pressured machine halves the cores, never below two", func(t *testing.T) {
		for cpus, want := range map[int]string{11: "5", 4: "2", 2: "2", 1: "2"} {
			if got := CheckGoMaxProcs(cpus, "", Red); got != want {
				t.Fatalf("CheckGoMaxProcs(%d, red) = %q, want %q", cpus, got, want)
			}
		}
		if got := CheckGoMaxProcs(11, "", Amber); got != "5" {
			t.Fatalf("amber caps too, got %q", got)
		}
	})

	t.Run("an operator's explicit setting always wins", func(t *testing.T) {
		if got := CheckGoMaxProcs(11, "8", Red); got != "8" {
			t.Fatalf("got %q, want the operator's 8", got)
		}
	})
}
