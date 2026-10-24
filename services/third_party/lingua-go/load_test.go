package lingua

import (
	"path/filepath"
	"testing"
)

func TestLoadModelsRefusesAMissingFile(t *testing.T) {
	err := LoadModels(filepath.Join(t.TempDir(), "models.bin"))
	if err == nil {
		t.Fatal("LoadModels on a missing file succeeded")
	}
	if ModelsAvailable() {
		t.Fatal("models are available after a failed load")
	}
}
