package redteam

import (
	scenario "github.com/langwatch/scenario/go"
)

// isPlainText reports whether the message content is a bare string.
func isPlainText(m scenario.Message) bool {
	return m.Role == scenario.RoleSystem || (len(m.Parts) == 0 && len(m.ToolCalls) == 0 && m.Role != scenario.RoleTool)
}

// contentText returns the message content as the JS SDK sees it: the
// string, or the JSON of its parts.
func contentText(m scenario.Message) string {
	if isPlainText(m) {
		return m.Text()
	}
	return string(scenario.AppendMessageContentJSON(nil, m))
}

// lastContent returns the content of the last message of the role that has
// any, as the JS SDK reads it, and its index; "" and -1 when none.
func lastContent(messages []scenario.Message, role scenario.Role) (string, int) {
	for i := len(messages) - 1; i >= 0; i-- {
		m := messages[i]
		if m.Role != role {
			continue
		}
		if isPlainText(m) {
			if m.Content != "" {
				return m.Content, i
			}
			continue
		}
		return contentText(m), i
	}
	return "", -1
}
