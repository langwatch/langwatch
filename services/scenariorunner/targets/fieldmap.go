package targets

import (
	"strings"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

// FieldMapping fills an agent input from scenario data or a literal value
// (FieldMappingSchema in the scenario contract).
type FieldMapping struct {
	Type     string   `json:"type"`
	SourceID string   `json:"sourceId,omitempty"`
	Path     []string `json:"path,omitempty"`
	Value    string   `json:"value,omitempty"`
}

// Mappings are field mappings by input identifier, in declared order.
type Mappings struct {
	Keys  []string
	Items map[string]FieldMapping
}

// Len is the number of mappings.
func (m *Mappings) Len() int { return len(m.Keys) }

// legacyFieldNames maps pre-rename field names to current ones.
var legacyFieldNames = map[string]string{
	"scenario_message":     "input",
	"conversation_history": "messages",
	"thread_id":            "threadId",
}

// SourceField is the scenario field behind a mapping, or "".
func (f FieldMapping) SourceField() string {
	if f.Type == "value" || f.SourceID != "scenario" || len(f.Path) == 0 {
		return ""
	}
	field := f.Path[0]
	if renamed, ok := legacyFieldNames[field]; ok {
		field = renamed
	}
	switch field {
	case "input", "messages", "threadId", "session":
		return field
	}
	return ""
}

// sessionAsText is the session as template text.
func sessionAsText(session any) string {
	if session == nil {
		return ""
	}
	if _, isAbsent := session.(absent); isAbsent {
		return ""
	}
	return jsjson.ToText(session)
}

// lastUserText is the last user message as text, or "".
func lastUserText(turn Turn) string {
	m, ok := turn.lastUserMessage()
	if !ok {
		return ""
	}
	return m.TextContent()
}

// resolveMapping is one mapping's value for a turn.
func resolveMapping(m FieldMapping, turn Turn, session any) string {
	if m.Type == "value" {
		return m.Value
	}
	if m.SourceID != "scenario" {
		return ""
	}
	switch m.SourceField() {
	case "input":
		return lastUserText(turn)
	case "messages":
		return string(MessagesJSON(turn.Messages))
	case "threadId":
		return turn.ThreadID
	case "session":
		return sessionAsText(session)
	}
	return ""
}

// resolveFieldMappings resolves every mapping for a turn.
func resolveFieldMappings(m *Mappings, turn Turn, session any) map[string]string {
	out := make(map[string]string, len(m.Keys))
	for _, k := range m.Keys {
		out[k] = resolveMapping(m.Items[k], turn, session)
	}
	return out
}

// scenarioFieldAliases are the identifiers best-match mapping accepts per
// scenario field, in the contract's order.
var scenarioFieldAliases = []struct {
	field   string
	aliases []string
}{
	{"input", []string{"input", "message", "scenario_message", "query", "question", "prompt", "text", "user_message", "user_input"}},
	{"messages", []string{"messages", "conversation_history", "history", "conversation", "chat_history", "context"}},
	{"threadId", []string{"threadid", "thread_id", "thread", "session_id", "sessionid", "conversation_id"}},
	{"session", []string{"session"}},
}

// computeBestMatchMappings maps declared inputs to scenario fields by name.
func computeBestMatchMappings(inputs []IO) *Mappings {
	out := &Mappings{Items: map[string]FieldMapping{}}
	used := map[string]bool{}
	for _, in := range inputs {
		if field := matchingField(strings.ToLower(in.Identifier), used); field != "" {
			out.add(in.Identifier, FieldMapping{Type: "source", SourceID: "scenario", Path: []string{field}})
			used[field] = true
		}
	}
	if len(inputs) == 1 && out.Len() == 0 {
		out.add(inputs[0].Identifier, FieldMapping{Type: "source", SourceID: "scenario", Path: []string{"input"}})
	}
	return out
}

func matchingField(identifier string, used map[string]bool) string {
	for _, entry := range scenarioFieldAliases {
		if used[entry.field] {
			continue
		}
		for _, alias := range entry.aliases {
			if alias == identifier {
				return entry.field
			}
		}
	}
	return ""
}

func (m *Mappings) add(key string, f FieldMapping) {
	if m.Items == nil {
		m.Items = map[string]FieldMapping{}
	}
	if _, ok := m.Items[key]; !ok {
		m.Keys = append(m.Keys, key)
	}
	m.Items[key] = f
}

// merged is m with other's mappings laid over it, as an object spread.
func (m *Mappings) merged(other *Mappings) *Mappings {
	out := &Mappings{Items: map[string]FieldMapping{}}
	for _, k := range m.Keys {
		out.add(k, m.Items[k])
	}
	for _, k := range other.Keys {
		out.add(k, other.Items[k])
	}
	return out
}
