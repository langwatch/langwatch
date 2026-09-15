package domain

import "testing"

func TestAlreadyWrappedRecognizesSharedQueueEntrypoints(t *testing.T) {
	for _, command := range []string{"haven run --sh 'pnpm typecheck'", "haven slot run -- pnpm typecheck", "'/opt/my tools/haven' typecheck worker", "cd /repo && haven slot run -- pnpm lint"} {
		if !AlreadyWrapped(command) {
			t.Errorf("would queue twice: %s", command)
		}
	}
	for _, command := range []string{"pnpm typecheck", "echo 'haven typecheck'", "other-haven typecheck", "haven status", "echo haven typecheck"} {
		if AlreadyWrapped(command) {
			t.Errorf("mistook a command for a queue owner: %s", command)
		}
	}
}
