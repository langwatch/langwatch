package procsupervisor

import (
	"context"
	"slices"
	"testing"
)

func TestEnvAtStartIsReadAtEachStartAndEnvWins(t *testing.T) {
	reads := 0
	c := proc{
		shell: "true",
		env:   []string{"SHARED=plan"},
		envAtStart: func() []string {
			reads++
			return []string{"FROM_ITEM=x", "SHARED=item"}
		},
	}
	for range 2 {
		cmd := c.command(context.Background())
		item, shared := slices.Index(cmd.Env, "SHARED=item"), slices.Index(cmd.Env, "SHARED=plan")
		if !slices.Contains(cmd.Env, "FROM_ITEM=x") || shared < item {
			t.Fatalf("env = %v, want the start-time entries before the plan's", cmd.Env[len(cmd.Env)-3:])
		}
	}
	if reads != 2 {
		t.Errorf("envAtStart was read %d times over two starts, want 2", reads)
	}
}
