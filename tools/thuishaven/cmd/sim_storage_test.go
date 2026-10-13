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

// @scenario "haven sim storage presigns, seeds and reads the request log for agents"
func TestStoragePresignSeedAndRequestsCallTheirRoutes(t *testing.T) {
	api, seen := stubSim(t, map[string]string{
		"GET /_sim/api/presign":  `{"url":"http://s/b/k?X-Amz-Signature=x","method":"PUT","expiresAt":"2026-10-09T10:00:00Z"}`,
		"POST /_sim/api/seed":    `{"seeded":2}`,
		"GET /_sim/api/requests": `{"requests":[{"method":"PUT","bucket":"b","key":"k","status":200,"at":"2026-10-09T09:00:00Z","auth":"presigned","requestId":"01"}]}`,
	})
	if err := storageCommand(api, simInv("presign", "b"), true); err == nil {
		t.Fatal("presign without a key was accepted")
	}
	put := simInv("presign", "b", "k/1")
	put.flags["--put"] = ""
	put.flags["--expires"] = "60"
	for _, inv := range []invocation{put, simInv("seed"), simInv("requests")} {
		if err := storageCommand(api, inv, false); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{"GET /_sim/api/presign?bucket=b&expires=60&key=k%2F1&method=PUT", "POST /_sim/api/seed?", "GET /_sim/api/requests?"}
	if strings.Join(*seen, "|") != strings.Join(want, "|") {
		t.Fatalf("requests = %v", *seen)
	}
}
