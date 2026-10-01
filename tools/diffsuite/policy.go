package diffsuite

import (
	"fmt"
	"strings"
)

// classify puts a stop reason into one of a few cause classes.
func classify(reason string) string {
	text := strings.ToLower(reason)
	for _, class := range []struct {
		name  string
		hints []string
	}{
		{"browser-closed", []string{"has been closed", "target closed", "page closed", "browser"}},
		{"sign-in", []string{"sign-in", "sign in", "signin", "login", "401"}},
		{"stack-unreachable", []string{"econnrefused", "econnreset", "connection refused", "no such host", "net::err_", "unreachable", "unhealthy", "never came up", "5xx", "seed", "500", "502", "503", "504"}},
		{"timeout", []string{"timeout", "timed out", "deadline"}},
	} {
		for _, hint := range class.hints {
			if strings.Contains(text, hint) {
				return class.name
			}
		}
	}
	return "other"
}

// stopReason is the text after the last "stopping: " in a tool's output.
func stopReason(line string) (string, bool) {
	at := strings.LastIndex(line, "stopping: ")
	if at < 0 {
		return "", false
	}
	return strings.TrimSpace(line[at+len("stopping: "):]), true
}

// verdict is why the policy wants every tool stopped, or "" for not yet.
// Callers hold the suite lock. "other" is never a shared cause: two unrelated
// errors are not the same error.
func (suite *suite) verdict() string {
	stopped, byCause := 0, map[string]int{}
	for _, tool := range suite.tools {
		if tool.stop != nil {
			stopped++
			byCause[tool.stop.Cause]++
		}
	}
	switch suite.policy {
	case "any":
		if stopped > 0 {
			return "a tool stopped (policy any)"
		}
	case "half", "same-cause":
		for cause, count := range byCause {
			if count >= 2 && cause != "other" {
				return fmt.Sprintf("%d tools stopped with the same cause: %s", count, cause)
			}
		}
		if suite.policy == "half" && stopped > 0 && stopped*2 >= len(suite.tools) {
			return fmt.Sprintf("%d of %d tools stopped (policy half)", stopped, len(suite.tools))
		}
	}
	return ""
}
