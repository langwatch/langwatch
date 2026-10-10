package visualdiff

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// holdAwake keeps a macOS machine from idle sleep for as long as this process
// lives, and warns when it runs on battery or in Low Power Mode: a closed lid
// on battery sleeps whatever the assertion says, and run 20260928-133143 lost
// ten minutes to it. The returned function releases the assertion.
func holdAwake(stderr io.Writer) func() {
	if runtime.GOOS != "darwin" {
		return func() {}
	}
	for _, warning := range PowerWarnings(pmset("batt"), pmset("")) {
		fmt.Fprintf(stderr, "warning: %s\n", warning)
	}
	// #nosec G204 -- a constant executable; the one argument is this process's own pid.
	command := exec.CommandContext(context.Background(), "caffeinate", "-i", "-w", strconv.Itoa(os.Getpid()))
	if err := command.Start(); err != nil {
		fmt.Fprintf(stderr, "warning: caffeinate did not start, the machine may sleep mid-run: %v\n", err)
		return func() {}
	}
	return func() {
		_ = command.Process.Kill()
		_ = command.Wait()
	}
}

// pmset is `pmset -g [topic]`'s output, or "" when it cannot be read.
func pmset(topic string) string {
	args := []string{"-g"}
	if topic != "" {
		args = append(args, topic)
	}
	// #nosec G204 -- a constant executable and constant arguments.
	output, err := exec.CommandContext(context.Background(), "pmset", args...).Output()
	if err != nil {
		return ""
	}
	return string(output)
}

// PowerWarnings reads `pmset -g batt` and `pmset -g` for the two states that
// slow or stop a run: battery power and Low Power Mode.
func PowerWarnings(battery, settings string) []string {
	var warnings []string
	if strings.Contains(battery, "'Battery Power'") {
		warnings = append(warnings, "running on battery: keep the lid open, a closed lid sleeps the machine mid-run")
	}
	for _, line := range strings.Split(settings, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "lowpowermode" && fields[1] == "1" {
			warnings = append(warnings, "Low Power Mode is on: every capture runs throttled")
		}
	}
	return warnings
}
