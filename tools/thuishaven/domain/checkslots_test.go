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
				slots, source := ResolveCheckSlots(c.ram, c.cpus, CheckEnv{})
				if slots != c.want || source != "machine" {
					t.Fatalf("got %d from %q, want %d from machine", slots, source, c.want)
				}
			})
		}
	})

	t.Run("given an explicit CHECK_SLOTS", func(t *testing.T) {
		if slots, source := ResolveCheckSlots(18*checkGiB, 11, CheckEnv{CheckSlots: "5", CI: "true"}); slots != 5 || source != "CHECK_SLOTS" {
			t.Fatalf("an explicit limit must win, even under CI: got %d from %q", slots, source)
		}
		if slots, _ := ResolveCheckSlots(18*checkGiB, 11, CheckEnv{CheckSlots: "off", CI: ""}); slots != 0 {
			t.Fatalf("off must disable the gate, got %d", slots)
		}
		if slots, source := ResolveCheckSlots(18*checkGiB, 11, CheckEnv{CheckSlots: "bananas", CI: ""}); slots != 2 || source != "machine" {
			t.Fatalf("a typo must fall back to the derived limit, got %d from %q", slots, source)
		}
	})

	t.Run("given CI without an explicit limit", func(t *testing.T) {
		if slots, source := ResolveCheckSlots(18*checkGiB, 11, CheckEnv{CheckSlots: "", CI: "true"}); slots != 0 || source != "CI" {
			t.Fatalf("CI must not queue, got %d from %q", slots, source)
		}
		if slots, _ := ResolveCheckSlots(18*checkGiB, 11, CheckEnv{CheckSlots: "", CI: "false"}); slots != 2 {
			t.Fatalf("CI=false is not CI, got %d", slots)
		}
	})
}

func TestCheckGoMemLimit(t *testing.T) {
	t.Run("half the machine, clamped to four and ten gibibytes", func(t *testing.T) {
		for ram, want := range map[uint64]string{
			8 * checkGiB:  "4GiB",
			18 * checkGiB: "9GiB",
			64 * checkGiB: "10GiB",
		} {
			if got := CheckGoMemLimit(ram, ""); got != want {
				t.Fatalf("CheckGoMemLimit(%d) = %q, want %q", ram, got, want)
			}
		}
	})

	t.Run("an operator's explicit limit always wins", func(t *testing.T) {
		if got := CheckGoMemLimit(18*checkGiB, "2GiB"); got != "2GiB" {
			t.Fatalf("got %q, want the operator's 2GiB", got)
		}
	})
}
