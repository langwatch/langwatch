package domain

import "testing"

// @scenario "No container runtime on a development machine runs langy on the host"
// @scenario "A development machine with a container runtime keeps the sandbox"
// @scenario "A non-development stack with no container runtime keeps the sandbox"
// @scenario "An explicit isolation choice is never overridden by the machine"
func TestResolveLangyTier(t *testing.T) {
	dev := LangyTierRequest{IsDevelopment: true, ContainerRuntimeAvailable: true}

	t.Run("given neither flag", func(t *testing.T) {
		t.Run("resolves to the sandboxed production-like tier", func(t *testing.T) {
			got, notice := ResolveLangyTier(dev)
			if got != LangyTierSandboxed {
				t.Fatalf("got %v, want sandboxed", got)
			}
			if notice != "" {
				t.Fatalf("a tier nobody was told about must carry no notice, got %q", notice)
			}
		})
	})

	t.Run("given only the container flag", func(t *testing.T) {
		t.Run("resolves to the container-unsafe tier", func(t *testing.T) {
			req := dev
			req.UnsafeContainer = true
			if got, _ := ResolveLangyTier(req); got != LangyTierContainerUnsafe {
				t.Fatalf("got %v, want container-unsafe", got)
			}
		})
	})

	t.Run("given both flags", func(t *testing.T) {
		t.Run("resolves to the host-unsafe tier", func(t *testing.T) {
			req := dev
			req.UnsafeContainer, req.UnsafeHostAccess = true, true
			if got, _ := ResolveLangyTier(req); got != LangyTierHostUnsafe {
				t.Fatalf("got %v, want host-unsafe", got)
			}
		})
	})

	t.Run("given only the host-access flag", func(t *testing.T) {
		t.Run("still resolves to host-unsafe (host access implies the relaxation)", func(t *testing.T) {
			req := dev
			req.UnsafeHostAccess = true
			if got, _ := ResolveLangyTier(req); got != LangyTierHostUnsafe {
				t.Fatalf("got %v, want host-unsafe", got)
			}
		})
	})

	t.Run("given a development stack with no container runtime", func(t *testing.T) {
		req := LangyTierRequest{IsDevelopment: true}

		t.Run("resolves to the host tier rather than running no manager", func(t *testing.T) {
			if got, _ := ResolveLangyTier(req); got != LangyTierHostUnsafe {
				t.Fatalf("got %v, want host-unsafe", got)
			}
		})

		t.Run("says so, and how to refuse", func(t *testing.T) {
			_, notice := ResolveLangyTier(req)
			if notice != LangyHostFallbackNotice {
				t.Fatalf("got %q, want the fallback notice", notice)
			}
		})

		// The knob is the developer's answer either way: a falsey
		// LANGY_UNSAFE_HOST_ACCESS is "never on my host", and the machine must
		// not talk them out of it.
		t.Run("keeps the sandbox when the developer refused host access explicitly", func(t *testing.T) {
			req := req
			req.HostAccessRefused = true
			got, notice := ResolveLangyTier(req)
			if got != LangyTierSandboxed {
				t.Fatalf("got %v, want sandboxed", got)
			}
			if notice != "" {
				t.Fatalf("a refusal that was respected needs no notice, got %q", notice)
			}
		})
	})

	t.Run("given a stack that is not development", func(t *testing.T) {
		t.Run("keeps the sandboxed tier even with no container runtime", func(t *testing.T) {
			got, notice := ResolveLangyTier(LangyTierRequest{})
			if got != LangyTierSandboxed {
				t.Fatalf("got %v, want sandboxed", got)
			}
			if notice != "" {
				t.Fatalf("nothing was resolved for anyone, got %q", notice)
			}
		})
	})
}

func TestIsDevelopmentEnvironment(t *testing.T) {
	t.Run("given no environment at all", func(t *testing.T) {
		t.Run("counts as development, because haven only ever runs one", func(t *testing.T) {
			if !IsDevelopmentEnvironment("", "") {
				t.Fatal("an unnamed environment must read as development")
			}
		})
	})

	t.Run("given a local-like name", func(t *testing.T) {
		for _, name := range []string{"local", "dev", "development", "test", "Development", " dev "} {
			if !IsDevelopmentEnvironment(name, "") {
				t.Errorf("NODE_ENV=%q must read as development", name)
			}
			if !IsDevelopmentEnvironment("", name) {
				t.Errorf("ENVIRONMENT=%q must read as development", name)
			}
		}
	})

	t.Run("given a name outside the allowlist", func(t *testing.T) {
		t.Run("is not development, so an unknown name fails closed", func(t *testing.T) {
			for _, name := range []string{"production", "staging", "prod", "sandbox"} {
				if IsDevelopmentEnvironment(name, "") {
					t.Errorf("NODE_ENV=%q must not read as development", name)
				}
				if IsDevelopmentEnvironment("development", name) {
					t.Errorf("ENVIRONMENT=%q must not read as development", name)
				}
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
