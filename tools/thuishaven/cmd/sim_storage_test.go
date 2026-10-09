package cmd

import (
	"strings"
	"testing"
)

func TestStorageDeleteNeedsBucketAndKeyAndEscapesThem(t *testing.T) {
	api, seen := stubSim(t, map[string]string{"DELETE /_sim/api/object": ""})
	if err := storageCommand(api, simInv("delete", "b"), true); err == nil {
		t.Fatal("delete without a key was accepted")
	}
	if err := storageCommand(api, simInv("delete", "b", "k/1"), true); err != nil {
		t.Fatal(err)
	}
	if got := (*seen)[0]; !strings.HasPrefix(got, "DELETE /_sim/api/object?") || !strings.Contains(got, "bucket=b&key=k%2F1") {
		t.Fatalf("request = %s", got)
	}
}

func TestStorageClearScopesToTheNamedBucket(t *testing.T) {
	api, seen := stubSim(t, map[string]string{"DELETE /_sim/api/objects": `{"deleted":2}`})
	if err := storageCommand(api, simInv("clear"), true); err != nil {
		t.Fatal(err)
	}
	if err := storageCommand(api, simInv("clear", "uploads"), true); err != nil {
		t.Fatal(err)
	}
	if (*seen)[0] != "DELETE /_sim/api/objects?" || (*seen)[1] != "DELETE /_sim/api/objects?bucket=uploads" {
		t.Fatalf("requests = %v", *seen)
	}
}
