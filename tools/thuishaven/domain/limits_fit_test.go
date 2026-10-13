package domain

import "testing"

func TestClickHouseMemoryFitsTheVMOnlyWhenItRunsThere(t *testing.T) {
	machine := LimitMachine{TotalRAMBytes: 64 << 30, NumCPU: 10}
	none := func(string) (string, string, bool) { return "", "", false }

	t.Run("a container ClickHouse bigger than the colima VM is refused", func(t *testing.T) {
		report := ResolveLimits(machine, "default", none)
		if err := report.Check(LimitClickHouseMemory, 18432); err == nil {
			t.Fatal("want a refusal: 18 GiB does not fit the default colima VM")
		}
	})

	t.Run("a native ClickHouse is not checked against the VM", func(t *testing.T) {
		report := ResolveLimits(machine, "default", none)
		report.NativeClickHouse = true
		if err := report.Check(LimitClickHouseMemory, 18432); err != nil {
			t.Fatalf("native ClickHouse runs outside the VM: %v", err)
		}
	})
}
