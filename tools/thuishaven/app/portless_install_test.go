package app

import (
	"errors"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// versionedProxy answers the two questions the bootstrap asks — is a real
// binary resolvable, and what does it say it is — and records whether an
// install was run. Nothing here downloads anything.
type versionedProxy struct {
	fakeProxy
	installed    bool
	version      string
	installCalls int
	installErr   error
}

func (p *versionedProxy) Installed() bool { return p.installed }
func (p *versionedProxy) Version() string { return p.version }
func (p *versionedProxy) Install() error {
	p.installCalls++
	return p.installErr
}

func TestEnsurePortlessInstalled(t *testing.T) {
	t.Run("given portless is missing", func(t *testing.T) {
		t.Run("when the stack comes up", func(t *testing.T) {
			proxy := &versionedProxy{}
			o := &Orchestrator{proxy: proxy}
			if err := o.ensurePortlessInstalled(); err != nil {
				t.Fatalf("ensurePortlessInstalled: %v", err)
			}
			if proxy.installCalls != 1 {
				t.Fatalf("missing portless must be installed once, got %d installs", proxy.installCalls)
			}
		})
	})

	t.Run("given portless at the pinned version", func(t *testing.T) {
		t.Run("when the stack comes up", func(t *testing.T) {
			proxy := &versionedProxy{installed: true, version: domain.PortlessVersion}
			o := &Orchestrator{proxy: proxy}
			if err := o.ensurePortlessInstalled(); err != nil {
				t.Fatalf("ensurePortlessInstalled: %v", err)
			}
			if proxy.installCalls != 0 {
				t.Fatalf("the pinned version must not be reinstalled, got %d installs", proxy.installCalls)
			}
		})
	})

	t.Run("given portless at another version", func(t *testing.T) {
		t.Run("when the stack comes up", func(t *testing.T) {
			proxy := &versionedProxy{installed: true, version: "0.0.1"}
			o := &Orchestrator{proxy: proxy}
			if err := o.ensurePortlessInstalled(); err != nil {
				t.Fatalf("ensurePortlessInstalled: %v", err)
			}
			if proxy.installCalls != 1 {
				t.Fatalf("another version must be upgraded to the pin, got %d installs", proxy.installCalls)
			}
		})
	})

	t.Run("given portless that will not report a version", func(t *testing.T) {
		t.Run("when the stack comes up", func(t *testing.T) {
			proxy := &versionedProxy{installed: true}
			o := &Orchestrator{proxy: proxy}
			if err := o.ensurePortlessInstalled(); err != nil {
				t.Fatalf("ensurePortlessInstalled: %v", err)
			}
			if proxy.installCalls != 0 {
				t.Fatalf("an unreadable version must not reinstall on every up, got %d installs", proxy.installCalls)
			}
		})
	})

	t.Run("given the install itself fails", func(t *testing.T) {
		t.Run("when the stack comes up", func(t *testing.T) {
			proxy := &versionedProxy{installErr: errInstallFailed}
			o := &Orchestrator{proxy: proxy}
			err := o.ensurePortlessInstalled()
			if err == nil {
				t.Fatal("a failed install must refuse the up rather than routing nothing")
			}
			if !strings.Contains(err.Error(), domain.PortlessPackage()) ||
				!strings.Contains(err.Error(), "npm install -g") {
				t.Fatalf("the refusal must name the pinned package and the hand command, got %q", err)
			}
		})
	})
}

var errInstallFailed = errors.New("npm exited 1")
