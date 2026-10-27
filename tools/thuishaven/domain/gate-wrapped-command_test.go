package domain

import "testing"

func TestAlreadyWrappedRecognizesSharedQueueEntrypoints(t *testing.T) {
	for _, command := range []string{"haven machine run --sh 'pnpm typecheck'", "haven machine slot run -- pnpm typecheck", "'/opt/my tools/haven' machine typecheck worker", "cd /repo && haven machine slot run -- pnpm lint"} {
		if !AlreadyWrapped(command) {
			t.Errorf("would queue twice: %s", command)
		}
	}
	for _, command := range []string{"pnpm typecheck", "echo 'haven machine typecheck'", "other-haven machine typecheck", "haven status", "echo haven machine typecheck"} {
		if AlreadyWrapped(command) {
			t.Errorf("mistook a command for a queue owner: %s", command)
		}
	}
}
