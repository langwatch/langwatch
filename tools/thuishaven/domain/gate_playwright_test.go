package domain

import (
	"regexp"
	"strings"
	"testing"
)

// @scenario "The gate points an agent at haven browser instead of interactive Playwright"
func TestPlaywrightRefusalRefusesInteractiveDoorsOnly(t *testing.T) {
	refused := []struct{ tool, command string }{
		{"mcp__playwright__browser_navigate", ""},
		{"mcp__plugin_playwright_playwright__browser_click", ""},
		{"Bash", "playwright-cli open https://app.x.langwatch.localhost"},
		{"Bash", "npx playwright open http://localhost:5560"},
		{"Bash", "npx -y playwright codegen"},
		{"Bash", "pnpm exec playwright show-trace trace.zip"},
		{"Bash", "cd apps/ui && npx @playwright/mcp@latest"},
		{"Bash", "rtk npx playwright screenshot http://x out.png"},
		{"Bash", `npx 'playwright' codegen`},
		{"Bash", `npx play"wright" open http://x`},
	}
	for _, c := range refused {
		reason, ok := PlaywrightRefusal(c.tool, c.command)
		if !ok || !strings.Contains(reason, "haven browser") {
			t.Errorf("%s %q was let through (or refused without pointing at haven browser): %q", c.tool, c.command, reason)
		}
	}
	if !mentionsPlaywright("x pplaywright") || mentionsPlaywright("playwrigh t") {
		t.Error("the quick playwright test missed a spelling or matched a split one")
	}
	allowed := []struct{ tool, command string }{
		{"Bash", "pnpm --filter @langwatch/ui test:e2e"},
		{"Bash", "npx playwright test dev/tests/agentic-e2e"},
		{"Bash", "pnpm exec playwright install chromium"},
		{"Bash", "grep -rn 'playwright open' docs/"},
		{"Bash", "haven browser open /settings --lane qa-1"},
		{"Edit", ""},
		{"mcp__langwatch__search_traces", ""},
	}
	for _, c := range allowed {
		if reason, ok := PlaywrightRefusal(c.tool, c.command); ok {
			t.Errorf("%s %q was refused: %q", c.tool, c.command, reason)
		}
	}
}

func TestHookMatcherWakesTheGateForPlaywrightTools(t *testing.T) {
	matcher := regexp.MustCompile("^(" + HookMatcher() + ")$")
	if !matcher.MatchString("mcp__playwright__browser_snapshot") || matcher.MatchString("mcp__langwatch__search") {
		t.Fatalf("matcher %q does not route exactly the Playwright MCP tools", HookMatcher())
	}
}
