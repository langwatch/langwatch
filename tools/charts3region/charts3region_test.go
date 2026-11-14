package charts3region

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// helmRender renders the real chart, skipping when helm or the chart's
// dependencies are not on this machine; the chart workflow runs cmd/charts3region
// with both.
func helmRender(t *testing.T) Render {
	t.Helper()
	if _, err := exec.LookPath("helm"); err != nil {
		t.Skip("helm is not installed")
	}
	chart, err := filepath.Abs("../../charts/langwatch")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(chart, "charts")); err != nil {
		t.Skip("chart dependencies are not built (helm dependency build charts/langwatch)")
	}
	return HelmRender(chart)
}

// @scenario "Helm chart passes the awsS3 provider's region to every process"
func TestRegionReachesEveryProcess(t *testing.T) {
	render := helmRender(t)
	for _, check := range Checks {
		if err := check.Run(render, t.TempDir()); err != nil {
			t.Fatalf("%s: %v", check.Name, err)
		}
	}
}

const twoContainers = `---
# Source: langwatch/templates/app/deployment.yaml
kind: Deployment
spec:
  template:
    spec:
      initContainers:
        - name: migrate
          env:
            - name: S3_BUCKET_NAME
              value: b
      containers:
        - name: app
          env:
            - name: S3_BUCKET_NAME
              value: b
            - name: S3_REGION
              value: eu-north1
---
# Source: langwatch/templates/workers/deployment.yaml
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: workers
          env:
            - name: OTHER
              value: x
`

func TestContainersReadsEveryContainerWithItsSource(t *testing.T) {
	got, err := Containers(twoContainers)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 containers, got %d: %+v", len(got), got)
	}
	if got[0].Source != "templates/app/deployment.yaml" || got[0].Name != "migrate" {
		t.Fatalf("first container is %+v", got[0])
	}
	if strings.Join(got[1].Values("S3_REGION"), ",") != "eu-north1" {
		t.Fatalf("app S3_REGION is %q", got[1].Values("S3_REGION"))
	}
}

func TestRegionEverywhereNamesTheContainerWithoutIt(t *testing.T) {
	containers, err := Containers(twoContainers)
	if err != nil {
		t.Fatal(err)
	}
	err = RegionEverywhere("eu-north1")(containers)
	if err == nil || !strings.Contains(err.Error(), "migrate") {
		t.Fatalf("want the migrate init container named, got %v", err)
	}
}

func TestRegionEverywhereNeedsTheWorkers(t *testing.T) {
	containers, err := Containers(strings.Replace(twoContainers,
		"        - name: migrate\n          env:\n            - name: S3_BUCKET_NAME\n              value: b\n", "", 1))
	if err != nil {
		t.Fatal(err)
	}
	err = RegionEverywhere("eu-north1")(containers)
	if err == nil || !strings.Contains(err.Error(), Workers) {
		t.Fatalf("want the workers deployment named, got %v", err)
	}
}

func TestNoRegionRefusesAnyS3Region(t *testing.T) {
	containers, err := Containers(twoContainers)
	if err != nil {
		t.Fatal(err)
	}
	if NoRegion(containers) == nil {
		t.Fatal("a rendered S3_REGION passed where none belongs")
	}
}
