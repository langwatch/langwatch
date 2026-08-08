package domain

import "testing"

// Real output from the machine that motivated ADR-090, trimmed to the lines
// that matter. Using the genuine article rather than an invented shape is the
// point: the two traps this parser exists for (16 KiB pages, and "occupied"
// versus "stored") are only visible in real output.
const realVMStat = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              168362.
Pages active:                            335384.
Pages inactive:                          317150.
Pages wired down:                        173102.
Pages stored in compressor:              678956.
Pages occupied by compressor:            127999.
Pageins:                               44817350.`

const realSwapUsage = `total = 4096.00M  used = 3210.75M  free = 885.25M  (encrypted)`

// @scenario "Compressor occupancy is read in bytes, not pages"
func TestParseVMStatReadsOccupiedPagesAtTheMachinesPageSize(t *testing.T) {
	t.Run("given real vm_stat output from an Apple silicon machine", func(t *testing.T) {
		pageSize, occupied, ok := ParseVMStat(realVMStat)

		t.Run("when compressor occupancy is computed", func(t *testing.T) {
			t.Run("the page size comes from the header, not a hard-coded constant", func(t *testing.T) {
				if !ok || pageSize != 16384 {
					t.Fatalf("expected a 16384-byte page, got %d (ok=%v)", pageSize, ok)
				}
			})

			t.Run("the occupied count is used rather than the stored count", func(t *testing.T) {
				if occupied != 127999 {
					t.Fatalf("expected the occupied line (127999), got %d", occupied)
				}
			})

			t.Run("which is about 2 GiB, not the 10 GiB the stored line would imply", func(t *testing.T) {
				bytes := occupied * pageSize
				if bytes < 1900*(1<<20) || bytes > 2100*(1<<20) {
					t.Fatalf("expected roughly 2 GiB, got %d bytes", bytes)
				}
			})
		})
	})

	t.Run("given output with no usable header", func(t *testing.T) {
		t.Run("it reports failure rather than assuming a page size", func(t *testing.T) {
			if _, _, ok := ParseVMStat("nonsense"); ok {
				t.Fatal("a missing page size must not fall back to a guess")
			}
		})
	})
}

func TestParseSwapUsage(t *testing.T) {
	t.Run("given real sysctl vm.swapusage output", func(t *testing.T) {
		used, total, ok := ParseSwapUsage(realSwapUsage)

		t.Run("when swap is read", func(t *testing.T) {
			t.Run("total and used are scaled from their suffixes", func(t *testing.T) {
				if !ok {
					t.Fatal("expected the line to parse")
				}
				if total != uint64(4096*(1<<20)) {
					t.Fatalf("expected 4096M total, got %d", total)
				}
				if used < uint64(3200*(1<<20)) || used > uint64(3220*(1<<20)) {
					t.Fatalf("expected roughly 3210M used, got %d", used)
				}
			})

			t.Run("and the pair lands in the amber-to-red band, as that machine did", func(t *testing.T) {
				level := ClassifyPressure(MemStat{
					TotalBytes: 18 * gib, SwapUsedBytes: used, SwapTotalBytes: total,
				})
				if level == Green {
					t.Fatal("3.2 GB of 4 GB swap should not read as an unloaded machine")
				}
			})
		})
	})

	t.Run("given a value with an unknown suffix", func(t *testing.T) {
		t.Run("it refuses rather than guessing a scale", func(t *testing.T) {
			if _, _, ok := ParseSwapUsage("total = 12X  used = 3X"); ok {
				t.Fatal("an unknown suffix must not be silently accepted")
			}
		})
	})
}
