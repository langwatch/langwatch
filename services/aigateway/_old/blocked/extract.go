package blocked

import "encoding/json"

// ExtractToolNames pulls tool names out of the raw request body for
// both OpenAI (`tools[].function.name`) and Anthropic
// (`tools[].name`) shapes. Returns an empty slice on any parse
// failure — caller treats that as "no tools declared".
//
// We deliberately do a targeted decode instead of re-parsing the
// whole chat-completions request: the hot path has already decoded
// `model` once, and we want to avoid pulling the full schema into
// this package (keeps the cycle graph clean).
func ExtractToolNames(body []byte) []string {
	var env struct {
		Tools []struct {
			Name     string `json:"name"` // Anthropic
			Function struct {
				Name string `json:"name"`
			} `json:"function"` // OpenAI
		} `json:"tools"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil
	}
	out := make([]string, 0, len(env.Tools))
	for _, t := range env.Tools {
		if t.Function.Name != "" {
			out = append(out, t.Function.Name)
			continue
		}
		if t.Name != "" {
			out = append(out, t.Name)
		}
	}
	return out
}

// ExtractMCPNames pulls MCP identifiers out of a request body.
// Matches against either a top-level `mcp` / `mcps` array of strings
// or objects carrying a `name` / `id` field. Anthropic's recent tool
// integration shape uses `mcp_servers: [{name, url}]` — we look there
// too.
func ExtractMCPNames(body []byte) []string {
	var env struct {
		MCP        []mcpEntry `json:"mcp"`
		MCPs       []mcpEntry `json:"mcps"`
		MCPServers []mcpEntry `json:"mcp_servers"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil
	}
	all := append(append([]mcpEntry{}, env.MCP...), env.MCPs...)
	all = append(all, env.MCPServers...)
	out := make([]string, 0, len(all))
	for _, m := range all {
		if m.Name != "" {
			out = append(out, m.Name)
		} else if m.ID != "" {
			out = append(out, m.ID)
		} else if m.Raw != "" {
			out = append(out, m.Raw)
		}
	}
	return out
}

type mcpEntry struct {
	Name string `json:"name,omitempty"`
	ID   string `json:"id,omitempty"`
	Raw  string `json:"-"`
}

// UnmarshalJSON accepts both strings ("mcp/foo") and objects
// ({name: "mcp/foo"}) so the VK author has flexibility.
func (m *mcpEntry) UnmarshalJSON(b []byte) error {
	if len(b) > 0 && b[0] == '"' {
		return json.Unmarshal(b, &m.Raw)
	}
	type alias mcpEntry
	return json.Unmarshal(b, (*alias)(m))
}

// ExtractURLs scans the raw request body for http:// and https:// URLs
// regardless of where they appear — user messages, system prompts,
// tool arguments, assistant history. A body-wide string scan is
// deliberately permissive: any URL in the payload is a URL the model
// could be asked to fetch, so if the VK bans it we block the request
// upfront. URL boundary detection stops at whitespace, closing
// quote, `<`, `>`, `)`, `]`, `}` — covers JSON-embedded URLs and
// markdown links.
func ExtractURLs(body []byte) []string {
	if len(body) == 0 {
		return nil
	}
	var out []string
	seen := make(map[string]struct{})
	s := string(body)
	for i := 0; i < len(s); {
		idx := indexAny(s[i:], "http://", "https://")
		if idx < 0 {
			break
		}
		start := i + idx
		end := start
		for end < len(s) && !isURLBoundary(s[end]) {
			end++
		}
		url := s[start:end]
		// Trim common trailing JSON punctuation that isn't part of the URL.
		for len(url) > 0 && isTrailingJunk(url[len(url)-1]) {
			url = url[:len(url)-1]
		}
		if len(url) > 8 { // longer than just the scheme
			if _, dup := seen[url]; !dup {
				seen[url] = struct{}{}
				out = append(out, url)
			}
		}
		i = end
	}
	return out
}

func indexAny(s string, needles ...string) int {
	first := -1
	for _, n := range needles {
		if idx := indexOf(s, n); idx >= 0 && (first < 0 || idx < first) {
			first = idx
		}
	}
	return first
}

func indexOf(s, n string) int {
	if len(n) == 0 || len(n) > len(s) {
		return -1
	}
	for i := 0; i+len(n) <= len(s); i++ {
		if s[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}

func isURLBoundary(c byte) bool {
	switch c {
	case ' ', '\t', '\n', '\r', '"', '\'', '<', '>':
		return true
	}
	return false
}

// isTrailingJunk strips punctuation that typically isn't URL-terminal
// but shows up in JSON / markdown contexts.
func isTrailingJunk(c byte) bool {
	switch c {
	case ',', '.', ';', ':', ')', ']', '}', '\\':
		return true
	}
	return false
}
