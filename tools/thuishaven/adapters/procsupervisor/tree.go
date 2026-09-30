package procsupervisor

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// killTree SIGKILLs pid's process group and every descendant of pid. A group
// kill alone is not enough: pnpm starts each script in a group of its own, so
// storybook or a vite server outlives it, keeps the lane's pipes open and
// blocks the launcher's shutdown forever. Descendants are listed before any
// signal, while their parent links still lead back to pid.
func killTree(pid int) {
	descendants := descendantsOf(pid, processParents())
	_ = syscall.Kill(-pid, syscall.SIGKILL)
	for _, child := range descendants {
		_ = syscall.Kill(child, syscall.SIGKILL)
	}
}

// processParents maps every live pid to its parent, from `ps` (macOS has no /proc).
// Its own short deadline: the caller's context is already cancelled by now.
func processParents() map[int]int {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ps", "-axo", "pid=,ppid=").Output()
	if err != nil {
		return nil
	}
	parents := map[int]int{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		child, errChild := strconv.Atoi(fields[0])
		parent, errParent := strconv.Atoi(fields[1])
		if errChild == nil && errParent == nil {
			parents[child] = parent
		}
	}
	return parents
}

// descendantsOf walks the parent map down from root, root itself excluded.
func descendantsOf(root int, parents map[int]int) []int {
	children := map[int][]int{}
	for child, parent := range parents {
		children[parent] = append(children[parent], child)
	}
	var out []int
	queue := []int{root}
	for len(queue) > 0 {
		next := queue[0]
		queue = queue[1:]
		for _, child := range children[next] {
			out = append(out, child)
			queue = append(queue, child)
		}
	}
	return out
}
