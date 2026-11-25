package portlessproxy

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestRoutesReadsPortlessRouteTable(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PORTLESS_STATE_DIR", dir)
	table := `[{"hostname":"app.feat-x.langwatch.localhost","port":9000,"pid":0}]`
	if err := os.WriteFile(filepath.Join(dir, "routes.json"), []byte(table), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := New(domain.DefaultNaming(""), "").Routes()["app.feat-x.langwatch.localhost"]; got != 9000 {
		t.Errorf("route port = %d, want 9000", got)
	}
}
