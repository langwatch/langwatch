package domain

import "testing"

func TestResolveLangyTier(t *testing.T) {
	t.Run("given neither flag", func(t *testing.T) {
		t.Run("resolves to the sandboxed production-like tier", func(t *testing.T) {
			if got := ResolveLangyTier(false, false); got != LangyTierSandboxed {
				t.Fatalf("got %v, want sandboxed", got)
			}
		})
	})

	t.Run("given only the container flag", func(t *testing.T) {
		t.Run("resolves to the container-unsafe tier", func(t *testing.T) {
			if got := ResolveLangyTier(true, false); got != LangyTierContainerUnsafe {
				t.Fatalf("got %v, want container-unsafe", got)
			}
		})
	})

	t.Run("given both flags", func(t *testing.T) {
		t.Run("resolves to the host-unsafe tier", func(t *testing.T) {
			if got := ResolveLangyTier(true, true); got != LangyTierHostUnsafe {
				t.Fatalf("got %v, want host-unsafe", got)
			}
		})
	})

	t.Run("given only the host-access flag", func(t *testing.T) {
		t.Run("still resolves to host-unsafe (host access implies the relaxation)", func(t *testing.T) {
			if got := ResolveLangyTier(false, true); got != LangyTierHostUnsafe {
				t.Fatalf("got %v, want host-unsafe", got)
			}
		})
	})
}

func TestLangyTier_RunsInContainer(t *testing.T) {
	t.Run("when sandboxed", func(t *testing.T) {
		if !LangyTierSandboxed.RunsInContainer() {
			t.Fatal("sandboxed must run in the container")
		}
	})
	t.Run("when container-unsafe", func(t *testing.T) {
		if !LangyTierContainerUnsafe.RunsInContainer() {
			t.Fatal("container-unsafe must run in the container")
		}
	})
	t.Run("when host-unsafe", func(t *testing.T) {
		if LangyTierHostUnsafe.RunsInContainer() {
			t.Fatal("host-unsafe must NOT run in the container")
		}
	})
}

func TestLangyTier_DisablesUIDSandbox(t *testing.T) {
	t.Run("when sandboxed", func(t *testing.T) {
		if LangyTierSandboxed.DisablesUIDSandbox() {
			t.Fatal("sandboxed keeps the UID sandbox on")
		}
	})
	t.Run("when container-unsafe", func(t *testing.T) {
		if !LangyTierContainerUnsafe.DisablesUIDSandbox() {
			t.Fatal("container-unsafe disables the UID sandbox")
		}
	})
	t.Run("when host-unsafe", func(t *testing.T) {
		if !LangyTierHostUnsafe.DisablesUIDSandbox() {
			t.Fatal("host-unsafe disables the UID sandbox")
		}
	})
}
