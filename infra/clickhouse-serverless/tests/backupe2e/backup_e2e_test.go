// Package backupe2e runs tests/e2e-backup-test.sh against a real ClickHouse
// and S3 store (ADR-191). It needs Docker and runs only when
// CH_BACKUP_E2E_IMAGE names an image: `make e2e-backup` builds and sets it.
package backupe2e

import (
	"os"
	"os/exec"
	"testing"
)

// @scenario "A real ClickHouse takes, chains and restores backups, and the sidecar survives a restart mid-backup"
func TestBackupAgainstRealClickHouse(t *testing.T) {
	image := os.Getenv("CH_BACKUP_E2E_IMAGE")
	if image == "" {
		t.Skip("CH_BACKUP_E2E_IMAGE not set; run `make e2e-backup` (needs Docker)")
	}
	cmd := exec.Command("bash", "../e2e-backup-test.sh", image)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("e2e-backup-test.sh: %v", err)
	}
}
