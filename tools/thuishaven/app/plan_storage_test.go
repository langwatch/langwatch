package app

import (
	"slices"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "haven gives storagesim a private bucket for a private-storage organization"
func TestStorageEnvHoldsAPrivateBucket(t *testing.T) {
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}}
	env := o.storageEnv(domain.Stack{Slug: "test", Services: []domain.Service{{Name: domain.StorageService, Port: 5590}}})
	if !slices.Contains(env, "STORAGESIM_BUCKETS=langwatch,langwatch-private") {
		t.Errorf("storagesim env %v does not hold the shared and the private bucket", env)
	}
}
