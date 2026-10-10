package app

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// restartSimsStack is a live dev checkout whose simulators are linked into Go,
// with the sims port held by pid simsPID and the go port by pid 201.
func restartSimsStack(t *testing.T, simsPID int) (*fakeSystem, *Orchestrator) {
	t.Helper()
	st := simulatorStack(simulatorCheckout(t), domain.LayoutModular)
	st.LauncherPID = 42
	store := &fakeStore{stacks: []domain.Stack{st}}
	sys := &fakeSystem{alive: map[int]bool{42: true}, pidsByPort: map[int][]int{44003: {201}, 45570: {simsPID}}}
	return sys, restartOrch(store, sys)
}

// @scenario "Restarting the sims lane in one Go process says it restarts the go lane"
func TestRestartSimsInOneGoProcess(t *testing.T) {
	t.Run("when the simulators run inside the go lane", func(t *testing.T) {
		sys, o := restartSimsStack(t, 201)
		msgs, err := o.restartServices("test", SimsLane)
		if err != nil {
			t.Fatalf("restartServices: %v", err)
		}
		if len(sys.groupTerminated) != 1 || sys.groupTerminated[0] != 201 {
			t.Errorf("terminated %v, want the go lane's group once", sys.groupTerminated)
		}
		joined := strings.Join(msgs, "\n")
		if !strings.Contains(joined, "LANGWATCH_DEV_ONE_PROCESS") || !strings.Contains(joined, GoLane+" ") {
			t.Errorf("messages %q do not say the go lane restarts with the simulators", joined)
		}
	})

	t.Run("when restarting everything, the shared process is bounced once", func(t *testing.T) {
		sys, o := restartSimsStack(t, 201)
		if _, err := o.restartServices("test", ""); err != nil {
			t.Fatalf("restartServices: %v", err)
		}
		if len(sys.groupTerminated) != 1 {
			t.Errorf("terminated %v, want the shared go process once", sys.groupTerminated)
		}
	})

	t.Run("when the simulators have their own lane, only it is bounced", func(t *testing.T) {
		sys, o := restartSimsStack(t, 301)
		msgs, err := o.restartServices("test", SimsLane)
		if err != nil {
			t.Fatalf("restartServices: %v", err)
		}
		if len(sys.groupTerminated) != 1 || sys.groupTerminated[0] != 301 {
			t.Errorf("terminated %v, want only the sims lane's group", sys.groupTerminated)
		}
		if strings.Contains(strings.Join(msgs, "\n"), "LANGWATCH_DEV_ONE_PROCESS") {
			t.Errorf("messages %q mention one-process mode for a split stack", msgs)
		}
	})
}
