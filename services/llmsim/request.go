package llmsim

import (
	"encoding/json"
	"fmt"
	mrand "math/rand/v2"
	"net/http"
	"slices"
	"strings"
)

// turn is one message, in either dialect, reduced to what an answer needs.
type turn struct {
	role    string   // system, user, assistant or tool
	text    string   // its text parts, joined
	calls   int      // tool calls an assistant turn made
	results []string // tool results the turn carries back
}

type tool struct {
	name   string
	schema map[string]any
}

// request is a chat call in either dialect.
type request struct {
	model        string
	turns        []turn
	tools        []tool
	forced       string // the tool the caller forces; "*" for any tool
	schema       map[string]any
	jsonObject   bool
	maxTokens    int
	stream       bool
	includeUsage bool
	seedBytes    []byte
}

func (req request) last() turn {
	if len(req.turns) == 0 {
		return turn{}
	}
	return req.turns[len(req.turns)-1]
}

func (req request) promptTokens() int {
	n := 0
	for _, t := range req.turns {
		n += 4 + tokens(t.text) + tokens(strings.Join(t.results, " "))
	}
	for _, t := range req.tools {
		b, _ := json.Marshal(t.schema)
		n += tokens(t.name) + tokens(string(b))
	}
	return max(n, 1)
}

// content flattens a message's content, a string or a list of typed parts.
func content(raw json.RawMessage) (text string, calls int, results []string) {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s, 0, nil
	}
	var parts []struct {
		Type    string          `json:"type"`
		Text    string          `json:"text"`
		Content json.RawMessage `json:"content"`
	}
	_ = json.Unmarshal(raw, &parts)
	var texts []string
	for _, p := range parts {
		switch p.Type {
		case "text", "input_text", "output_text":
			texts = append(texts, p.Text)
		case "tool_use":
			calls++
		case "tool_result":
			result, _, _ := content(p.Content)
			results = append(results, result)
		}
	}
	return strings.Join(texts, "\n"), calls, results
}

func intOf(raw json.RawMessage) int {
	var n int
	_ = json.Unmarshal(raw, &n)
	return n
}

func boolOf(raw json.RawMessage) bool {
	var b bool
	_ = json.Unmarshal(raw, &b)
	return b
}

// parseOpenAI reads a chat-completions body.
func parseOpenAI(body map[string]json.RawMessage) request {
	req := request{model: str(body["model"]), seedBytes: body["messages"], stream: boolOf(body["stream"])}
	req.maxTokens = intOf(body["max_completion_tokens"])
	if req.maxTokens == 0 {
		req.maxTokens = intOf(body["max_tokens"])
	}
	var opts struct {
		IncludeUsage bool `json:"include_usage"`
	}
	_ = json.Unmarshal(body["stream_options"], &opts)
	req.includeUsage = opts.IncludeUsage
	req.turns = openAITurns(body["messages"])
	req.tools = openAITools(body)
	applyOpenAIToolChoice(&req, body["tool_choice"])
	applyOpenAIResponseFormat(&req, body["response_format"])
	return req
}

// openAITurns reads chat-completions messages; tool and function results
// become tool turns and developer messages system ones.
func openAITurns(raw json.RawMessage) []turn {
	var msgs []struct {
		Role         string            `json:"role"`
		Content      json.RawMessage   `json:"content"`
		ToolCalls    []json.RawMessage `json:"tool_calls"`
		FunctionCall json.RawMessage   `json:"function_call"`
	}
	_ = json.Unmarshal(raw, &msgs)
	var turns []turn
	for _, m := range msgs {
		text, _, _ := content(m.Content)
		t := turn{role: m.Role, text: text, calls: len(m.ToolCalls)}
		if len(m.FunctionCall) > 0 && string(m.FunctionCall) != "null" {
			t.calls++
		}
		switch m.Role {
		case "tool", "function":
			t.role, t.text, t.results = "tool", "", []string{text}
		case "developer":
			t.role = "system"
		}
		turns = append(turns, t)
	}
	return turns
}

// openAITools reads the offered tools, then the legacy functions.
func openAITools(body map[string]json.RawMessage) []tool {
	var tools []struct {
		Function struct {
			Name       string         `json:"name"`
			Parameters map[string]any `json:"parameters"`
		} `json:"function"`
	}
	_ = json.Unmarshal(body["tools"], &tools)
	var out []tool
	for _, t := range tools {
		out = append(out, tool{name: t.Function.Name, schema: t.Function.Parameters})
	}
	var functions []struct {
		Name       string         `json:"name"`
		Parameters map[string]any `json:"parameters"`
	}
	_ = json.Unmarshal(body["functions"], &functions)
	for _, f := range functions {
		out = append(out, tool{name: f.Name, schema: f.Parameters})
	}
	return out
}

// applyOpenAIToolChoice forces a tool ("required" or a named function) or
// withdraws them all ("none").
func applyOpenAIToolChoice(req *request, raw json.RawMessage) {
	var choice any
	_ = json.Unmarshal(raw, &choice)
	switch c := choice.(type) {
	case string:
		switch c {
		case "required":
			req.forced = "*"
		case "none":
			req.tools = nil
		}
	case map[string]any:
		if fn, ok := c["function"].(map[string]any); ok {
			req.forced, _ = fn["name"].(string)
		}
	}
}

// applyOpenAIResponseFormat reads a json_schema or json_object response format.
func applyOpenAIResponseFormat(req *request, raw json.RawMessage) {
	var format struct {
		Type       string `json:"type"`
		JSONSchema struct {
			Schema map[string]any `json:"schema"`
		} `json:"json_schema"`
	}
	_ = json.Unmarshal(raw, &format)
	switch format.Type {
	case "json_schema":
		req.schema = format.JSONSchema.Schema
		req.jsonObject = req.schema == nil
	case "json_object":
		req.jsonObject = true
	}
}

// parseAnthropic reads a messages body.
func parseAnthropic(body map[string]json.RawMessage) request {
	req := request{
		model:        str(body["model"]),
		seedBytes:    append(append([]byte{}, body["system"]...), body["messages"]...),
		maxTokens:    intOf(body["max_tokens"]),
		stream:       boolOf(body["stream"]),
		includeUsage: true,
	}
	if system, _, _ := content(body["system"]); system != "" {
		req.turns = append(req.turns, turn{role: "system", text: system})
	}
	var msgs []struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	}
	_ = json.Unmarshal(body["messages"], &msgs)
	for _, m := range msgs {
		text, calls, results := content(m.Content)
		req.turns = append(req.turns, turn{role: m.Role, text: text, calls: calls, results: results})
	}

	var tools []struct {
		Name        string         `json:"name"`
		InputSchema map[string]any `json:"input_schema"`
	}
	_ = json.Unmarshal(body["tools"], &tools)
	for _, t := range tools {
		req.tools = append(req.tools, tool{name: t.Name, schema: t.InputSchema})
	}
	var choice struct {
		Type string `json:"type"`
		Name string `json:"name"`
	}
	_ = json.Unmarshal(body["tool_choice"], &choice)
	switch choice.Type {
	case "any":
		req.forced = "*"
	case "tool":
		req.forced = choice.Name
	case "none":
		req.tools = nil
	}

	// Structured output, under either of the names Anthropic has used for it.
	var format struct {
		Schema map[string]any `json:"schema"`
		Format struct {
			Schema map[string]any `json:"schema"`
		} `json:"format"`
	}
	_ = json.Unmarshal(body["output_format"], &format)
	req.schema = format.Schema
	if req.schema == nil {
		_ = json.Unmarshal(body["output_config"], &format)
		req.schema = format.Format.Schema
	}
	return req
}

// call is one tool call the answer makes; id is bare hex the dialect prefixes.
type call struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Args string `json:"arguments"`
}

// reply is an answer before it is written in the caller's dialect.
type reply struct {
	ID     string `json:"id"`
	Mode   string `json:"mode"` // markov, json, tools or langy
	Text   string `json:"text"`
	Calls  []call `json:"calls,omitempty"`
	Finish string `json:"finish"` // stop, length or tool_calls
	In     int    `json:"inputTokens"`
	Out    int    `json:"outputTokens"`
}

// answer picks the mode: Langy echo when the header or model asks for it,
// otherwise the Markov chain and its structured variants.
func (s *Server) answer(h http.Header, req request) reply {
	r := s.rng(h, req)
	var rep reply
	if text, ok := cannedFor(req.model); ok {
		rep = reply{Mode: "canned", Text: text, Finish: "stop"}
	} else if strings.EqualFold(h.Get(HeaderMode), "langy") || strings.Contains(req.model, "langy-echo") {
		rep = langy(req, r)
	} else {
		rep = s.markovReply(req, r)
	}
	rep.ID = fmt.Sprintf("%016x", r.Uint64())
	rep.In = req.promptTokens()
	rep.Out = tokens(rep.Text)
	for _, c := range rep.Calls {
		rep.Out += tokens(c.Name) + tokens(c.Args)
	}
	if req.maxTokens > 0 && rep.Finish == "length" {
		rep.Out = min(rep.Out, req.maxTokens)
	}
	rep.Out = max(rep.Out, 1)
	return rep
}

func (s *Server) markovReply(req request, r *mrand.Rand) reply {
	g := &schemaGen{r: r, chain: s.chain}
	switch {
	case req.schema != nil:
		g.root = req.schema
		b, _ := json.Marshal(g.value(req.schema, 0))
		return reply{Mode: "json", Text: string(b), Finish: "stop"}
	case len(req.tools) > 0 && (req.forced != "" || (len(req.last().results) == 0 && r.IntN(2) == 0)):
		return toolReply(req, g)
	case req.jsonObject:
		text, _ := s.chain.text(r, 8, 0)
		b, _ := json.Marshal(map[string]string{"answer": text})
		return reply{Mode: "json", Text: string(b), Finish: "stop"}
	}
	text, cut := s.chain.text(r, 12+r.IntN(40), req.maxTokens)
	if cut {
		return reply{Mode: "markov", Text: text, Finish: "length"}
	}
	return reply{Mode: "markov", Text: text, Finish: "stop"}
}

// toolReply calls the forced tool, or the first one offered, with arguments
// drawn from its schema.
func toolReply(req request, g *schemaGen) reply {
	t := req.tools[0]
	for _, offered := range req.tools {
		if offered.name == req.forced {
			t = offered
		}
	}
	args := "{}"
	if t.schema != nil {
		g.root = t.schema
		b, _ := json.Marshal(g.value(t.schema, 0))
		args = string(b)
	}
	return reply{Mode: "tools", Calls: []call{{ID: fmt.Sprintf("%016x", g.r.Uint64()), Name: t.name, Args: args}}, Finish: "tool_calls"}
}

// step is what one assistant turn of a Langy script says and calls.
type step struct {
	text  []string
	calls []call
}

// parseScript reads the Langy grammar: "/tool <name> <json args>" is a tool
// call, "/next" starts the turn taken after the tool results come back, and
// any other line is text. scripted is false when no line is a command.
func parseScript(s string) (steps []step, scripted bool) {
	var cur step
	for line := range strings.SplitSeq(s, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case trimmed == "/next":
			steps, cur, scripted = append(steps, cur), step{}, true
		case strings.HasPrefix(trimmed, "/tool "):
			name, args, _ := strings.Cut(strings.TrimSpace(strings.TrimPrefix(trimmed, "/tool ")), " ")
			cur.calls, scripted = append(cur.calls, call{Name: name, Args: strings.TrimSpace(args)}), true
		default:
			cur.text = append(cur.text, line)
		}
	}
	return append(steps, cur), scripted
}

// lastUserTurn is the index of the last user message that is not a tool
// result, or -1.
func lastUserTurn(turns []turn) int {
	for i := len(turns) - 1; i >= 0; i-- {
		if t := turns[i]; t.role == "user" && len(t.results) == 0 {
			return i
		}
	}
	return -1
}

// callingTurns counts the turns that made a tool call.
func callingTurns(turns []turn) int {
	round := 0
	for _, t := range turns {
		if t.calls > 0 {
			round++
		}
	}
	return round
}

// langy does what the last user message says: echo it, or run its script,
// then echo the tool results back once the script has no step left.
func langy(req request, r *mrand.Rand) reply {
	user := lastUserTurn(req.turns)
	if user < 0 {
		return reply{Mode: "langy", Text: "llmsim langy mode: there is no user message to follow", Finish: "stop"}
	}
	script := req.turns[user].text
	steps, scripted := parseScript(script)
	round := callingTurns(req.turns[user+1:])
	switch {
	case user == len(req.turns)-1 && !scripted:
		return reply{Mode: "langy", Text: script, Finish: "stop"}
	case scripted && round < len(steps):
		return langyStep(req, steps[round], r)
	}
	return reply{Mode: "langy", Text: strings.Join(req.last().results, "\n"), Finish: "stop"}
}

// langyStep emits a step's calls exactly, or refuses in plain text when a
// call names a tool the request does not offer or carries invalid JSON.
func langyStep(req request, st step, r *mrand.Rand) reply {
	offered := make([]string, 0, len(req.tools))
	for _, t := range req.tools {
		offered = append(offered, t.name)
	}
	rep := reply{Mode: "langy", Text: strings.TrimSpace(strings.Join(st.text, "\n")), Finish: "stop"}
	for _, c := range st.calls {
		if c.Args == "" {
			c.Args = "{}"
		}
		refuse := ""
		switch {
		case !slices.Contains(offered, c.Name):
			refuse = fmt.Sprintf("llmsim: tool %q is not offered by this request (offered: %s)", c.Name, strings.Join(offered, ", "))
		case !json.Valid([]byte(c.Args)):
			refuse = fmt.Sprintf("llmsim: the arguments for tool %q are not valid JSON: %s", c.Name, c.Args)
		}
		if refuse != "" {
			return reply{Mode: "langy", Text: refuse, Finish: "stop"}
		}
		c.ID = fmt.Sprintf("%016x", r.Uint64())
		rep.Calls = append(rep.Calls, c)
	}
	if len(rep.Calls) > 0 {
		rep.Finish = "tool_calls"
	}
	return rep
}
