package lambdaboot_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/lambdaboot"
)

// These run the check against real images, built from the two fixtures in
// testdata: both serve /healthz on 8080 and run as uid 65532, like the
// distroless nonroot base, and the bad one starts in a home directory only
// that uid may enter, the image that shipped and could not start on Lambda.
// They need a Docker daemon. Without one they skip on a laptop and fail in
// CI, where a skip would leave the check proved by nothing.

func requireDocker(t *testing.T) {
	t.Helper()
	if err := exec.Command("docker", "info").Run(); err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("no Docker daemon in CI, so the real-image boot check cannot run: %v", err)
		}
		t.Skip("no Docker daemon: the real-image boot check needs one")
	}
}

func buildFixture(t *testing.T, name string) string {
	t.Helper()
	tag := "lambdaboot-fixture-" + name + ":test"
	out, err := exec.Command("docker", "build", "--quiet", "-t", tag, filepath.Join("testdata", name)).CombinedOutput()
	if err != nil {
		t.Fatalf("docker build %s: %v\n%s", name, err, out)
	}
	t.Cleanup(func() { _ = exec.Command("docker", "rmi", "-f", tag).Run() })
	return tag
}

func realOptions(image string) lambdaboot.Options {
	return lambdaboot.Options{
		Image:    image,
		User:     "9999:9999",
		Port:     8080,
		Path:     "/healthz",
		Timeout:  30 * time.Second,
		Interval: 200 * time.Millisecond,
	}
}

// @scenario "The boot check passes an image that serves its health check as a foreign user"
func TestCheckWithDockerPassesAnImageAForeignUserCanStart(t *testing.T) {
	requireDocker(t)
	image := buildFixture(t, "good")

	if err := lambdaboot.Check(context.Background(), realOptions(image), lambdaboot.Real); err != nil {
		t.Fatalf("Check() = %v, want nil", err)
	}
}

// @scenario "The boot check refuses a working directory a foreign user cannot enter"
func TestCheckWithDockerFailsAnImageThatStartsInAPrivateHome(t *testing.T) {
	requireDocker(t)
	image := buildFixture(t, "private-home")

	err := lambdaboot.Check(context.Background(), realOptions(image), lambdaboot.Real)

	if err == nil {
		t.Fatal("Check() = nil, want a failure")
	}
	if !strings.Contains(err.Error(), "permission denied") {
		t.Errorf("error %q does not say why it could not start", err)
	}
}
