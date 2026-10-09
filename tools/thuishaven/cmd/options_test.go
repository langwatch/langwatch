package cmd

import (
	"os"
	"testing"
)

// @scenario "A local stack runs the ui, the api and the worker in one process unless split"
func TestTheAppLaneIsOneProcessUnlessSplit(t *testing.T) {
	t.Run("when LANGWATCH_DEV_ONE_PROCESS is unset", func(t *testing.T) {
		t.Setenv("LANGWATCH_DEV_ONE_PROCESS", "")
		if err := os.Unsetenv("LANGWATCH_DEV_ONE_PROCESS"); err != nil {
			t.Fatal(err)
		}
		if !optionsFromEnv(t.TempDir()).ShouldRunOneProcess {
			t.Error("the ui, api and worker are split by default; one app lane is the default")
		}
	})
	t.Run("when LANGWATCH_DEV_ONE_PROCESS is 0", func(t *testing.T) {
		t.Setenv("LANGWATCH_DEV_ONE_PROCESS", "0")
		if optionsFromEnv(t.TempDir()).ShouldRunOneProcess {
			t.Error("LANGWATCH_DEV_ONE_PROCESS=0 still runs one app lane")
		}
	})
}
