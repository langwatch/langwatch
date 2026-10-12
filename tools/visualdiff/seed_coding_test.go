package visualdiff

import (
	"encoding/json"
	"strings"
	"testing"
)

// @scenario "The coding-assistant seed posts sessions the way the ingest CLI does"
func TestCodingSessionPayloadsCarryTheSessionIdentity(t *testing.T) {
	const now = int64(1_780_000_000_000)
	encoded, err := json.Marshal(append(codingSessionLogs(now), codingSessionSpans(now)...))
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	for _, want := range []string{
		CodingSessionAlpha, CodingSessionBeta, CodingAlphaBranch, CodingBetaBranch,
		sessionContextEvent, "claude_code.api_request", "claude_code.llm_request", langwatchHookScope,
	} {
		if !strings.Contains(text, want) {
			t.Errorf("payloads lack %q", want)
		}
	}
}
