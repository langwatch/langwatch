package blocked

import (
	"testing"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

func TestCompile_InvalidPattern(t *testing.T) {
	_, err := Compile(auth.BlockedPatternConfig{
		Tools: auth.BlockedPattern{Deny: []string{"["}},
	})
	if err == nil {
		t.Fatal("expected error for invalid regex")
	}
}

func TestEvaluate_DenyWins(t *testing.T) {
	c, err := Compile(auth.BlockedPatternConfig{
		Tools: auth.BlockedPattern{Deny: []string{`^shell\.`}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, blocked := Evaluate("shell.exec", c.Tools); !blocked {
		t.Error("shell.exec must be denied")
	}
	if _, blocked := Evaluate("fs.read", c.Tools); blocked {
		t.Error("fs.read must pass")
	}
}

func TestEvaluate_AllowlistEnforced(t *testing.T) {
	c, err := Compile(auth.BlockedPatternConfig{
		Tools: auth.BlockedPattern{Allow: []string{`^safe_`}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, blocked := Evaluate("safe_ls", c.Tools); blocked {
		t.Error("safe_ls must pass when on allowlist")
	}
	if _, blocked := Evaluate("shell.exec", c.Tools); !blocked {
		t.Error("shell.exec must be denied (not in allowlist)")
	}
}

func TestEvaluate_DenyBeatsAllow(t *testing.T) {
	c, err := Compile(auth.BlockedPatternConfig{
		Tools: auth.BlockedPattern{
			Deny:  []string{`^fs\.write$`},
			Allow: []string{`^fs\.`},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, blocked := Evaluate("fs.read", c.Tools); blocked {
		t.Error("fs.read should pass (allow wins, no deny match)")
	}
	if _, blocked := Evaluate("fs.write", c.Tools); !blocked {
		t.Error("fs.write should be denied — deny always wins over allow")
	}
}

func TestExtractToolNames_OpenAIShape(t *testing.T) {
	body := []byte(`{"tools":[
		{"type":"function","function":{"name":"search_docs"}},
		{"type":"function","function":{"name":"shell.exec"}}
	]}`)
	names := ExtractToolNames(body)
	if len(names) != 2 || names[0] != "search_docs" || names[1] != "shell.exec" {
		t.Errorf("got %+v", names)
	}
}

func TestExtractToolNames_AnthropicShape(t *testing.T) {
	body := []byte(`{"tools":[{"name":"search_docs"},{"name":"fs.write"}]}`)
	names := ExtractToolNames(body)
	if len(names) != 2 || names[0] != "search_docs" || names[1] != "fs.write" {
		t.Errorf("got %+v", names)
	}
}

func TestFirstBlockedTool(t *testing.T) {
	c, _ := Compile(auth.BlockedPatternConfig{
		Tools: auth.BlockedPattern{Deny: []string{`^shell\.`}},
	})
	tool, reason := FirstBlockedTool([]string{"fs.read", "shell.exec", "net.get"}, c)
	if tool != "shell.exec" {
		t.Errorf("want shell.exec, got %q", tool)
	}
	if reason == "" {
		t.Error("reason must carry the deny pattern for the error envelope")
	}
}

func TestExtractMCPNames_StringList(t *testing.T) {
	body := []byte(`{"mcp":["mcp/verified-docs","mcp/unverified-scratch"]}`)
	names := ExtractMCPNames(body)
	if len(names) != 2 || names[1] != "mcp/unverified-scratch" {
		t.Errorf("got %+v", names)
	}
}

func TestExtractMCPNames_ServerObjects(t *testing.T) {
	body := []byte(`{"mcp_servers":[{"name":"mcp/verified","url":"..."}]}`)
	names := ExtractMCPNames(body)
	if len(names) != 1 || names[0] != "mcp/verified" {
		t.Errorf("got %+v", names)
	}
}

func TestNilCompiledIsSafe(t *testing.T) {
	if tool, _ := FirstBlockedTool([]string{"anything"}, nil); tool != "" {
		t.Error("nil compiled must allow")
	}
}

func TestExtractURLs_FromJSONBody(t *testing.T) {
	body := []byte(`{"messages":[
		{"role":"user","content":"check https://allowed.example.com/docs and http://evil.com/steal."}
	]}`)
	urls := ExtractURLs(body)
	want := map[string]bool{
		"https://allowed.example.com/docs": true,
		"http://evil.com/steal":            true,
	}
	got := map[string]bool{}
	for _, u := range urls {
		got[u] = true
	}
	for w := range want {
		if !got[w] {
			t.Errorf("missing URL: %q (got %v)", w, urls)
		}
	}
}

func TestExtractURLs_Deduplicates(t *testing.T) {
	body := []byte(`{"content":"https://a.example https://a.example https://a.example"}`)
	urls := ExtractURLs(body)
	if len(urls) != 1 || urls[0] != "https://a.example" {
		t.Errorf("want 1 dedup URL, got %+v", urls)
	}
}

func TestExtractURLs_StripsTrailingPunctuation(t *testing.T) {
	// Markdown + JSON tend to put commas/brackets right after URLs.
	body := []byte(`{"a":"https://foo.com).","b":"https://bar.com/x]"}`)
	urls := ExtractURLs(body)
	wantA, wantB := "https://foo.com", "https://bar.com/x"
	foundA, foundB := false, false
	for _, u := range urls {
		if u == wantA {
			foundA = true
		}
		if u == wantB {
			foundB = true
		}
	}
	if !foundA || !foundB {
		t.Errorf("want %q and %q in %+v", wantA, wantB, urls)
	}
}

func TestFirstBlockedURL(t *testing.T) {
	c, _ := Compile(auth.BlockedPatternConfig{
		URLs: auth.BlockedPattern{Deny: []string{`^https?://evil\.`}},
	})
	url, reason := FirstBlockedURL([]string{"https://good.com", "http://evil.site/x"}, c)
	if url != "http://evil.site/x" {
		t.Errorf("want evil.site, got %q", url)
	}
	if reason == "" {
		t.Error("reason must carry the deny pattern source")
	}
}

func TestURLAllowlist_BlocksNonMatching(t *testing.T) {
	c, _ := Compile(auth.BlockedPatternConfig{
		URLs: auth.BlockedPattern{Allow: []string{`^https://allowed\.example\.com/`}},
	})
	url, _ := FirstBlockedURL([]string{"https://other.com/x"}, c)
	if url == "" {
		t.Error("URL not in allowlist must be blocked")
	}
}
