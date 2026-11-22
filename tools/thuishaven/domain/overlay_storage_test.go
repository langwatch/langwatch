package domain

import (
	"slices"
	"testing"
)

const storageRoute = "https://storage.feat-x.langwatch.localhost"

// @scenario "haven runs storagesim by default and points the product at it"
func TestStorageS3EnvPointsTheProductAtStoragesim(t *testing.T) {
	if !DefaultSelection().Storage {
		t.Fatal("storage is off in a fresh worktree's selection")
	}
	env := StorageS3Env(map[string]string{"S3_ACCESS_KEY_ID": "real"}, storageRoute)
	for _, want := range []string{
		"STORED_OBJECTS_BACKEND=s3", "S3_BUCKET_NAME=langwatch", "S3_ENDPOINT=" + storageRoute,
		"S3_ACCESS_KEY_ID=storagesim", "S3_SECRET_ACCESS_KEY=storagesim",
	} {
		if !slices.Contains(env, want) {
			t.Errorf("overlay %v lacks %q", env, want)
		}
	}
}

// @scenario "A developer's own object storage choice wins"
func TestStorageS3EnvStaysOutOfAChosenBackend(t *testing.T) {
	for _, key := range StorageProviderEnvVars {
		if env := StorageS3Env(map[string]string{key: "x"}, storageRoute); env != nil {
			t.Errorf("with %s set the overlay is %v, want nothing", key, env)
		}
	}
}
