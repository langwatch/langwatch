package targets

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// The customer-facing wording of a code agent's failures
// (execution-error.rules.ts): user code from infrastructure, internal
// addresses out, noise stripped, length capped.

const maxDetailLength = 2_000

// Failure sources.
const (
	sourceUserCode   = "user_code"
	sourceNLPService = "nlp_service"
)

var noisePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?m)^AI SDK Warning .*$`),
	regexp.MustCompile(`(?m)^OTEL .*flushed.*$`),
	regexp.MustCompile(`(?m)^Flushing OTEL traces\.\.\.$`),
	regexp.MustCompile(`(?m)^\s*at v2 specification compatibility mode\..*$`),
}

var (
	ansiEscape         = regexp.MustCompile("\x1b\\[[0-9;]*[A-Za-z]")
	engineHarnessFrame = regexp.MustCompile(`(?m)^[ \t]*File "/tmp/nlpgo-codeblock-[^"]*",.*$\n?(?:[ \t]{4,}[^ \t\n].*$\n?|[ \t]*\^+[ \t]*$\n?)*`)
	blankRuns          = regexp.MustCompile(`\n[ \t]*\n[ \t]*\n*`)
	urlPattern         = regexp.MustCompile(`(?i)\b[a-z][a-z0-9+.-]*://\S+`)
	ipAddress          = regexp.MustCompile(`\[[0-9a-fA-F:]+\](?::\d{1,5})?|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b`)
	tokenWithPort      = regexp.MustCompile(`\b[A-Za-z0-9][A-Za-z0-9._-]*:\d{2,5}\b`)
	sourceFileSuffix   = regexp.MustCompile(`(?i)\.(py|pyc|ts|tsx|js|jsx|mjs|cjs|go|rb|java|kt|c|cc|cpp|h|hpp|rs|sh|sql|json|ya?ml|toml|txt|log)$`)
	hostChars          = regexp.MustCompile(`[.-]`)
	digitsAndDots      = regexp.MustCompile(`^[\d.]+$`)
)

// platformEngineErrorTypes are engine error types that are not customer Python.
var platformEngineErrorTypes = map[string]bool{
	"engine_error": true, "llm_executor_unavailable": true, "invalid_workflow": true, "context_canceled": true,
}

// customerFaultHerrCodes are engine refusals the customer's own config caused.
var customerFaultHerrCodes = map[string]bool{
	"bad_request": true, "invalid_dataset": true, "unsupported_node_kind": true,
	"code_block_timeout": true, "ssrf_blocked": true,
}

// engineError is the engine's structured error on a 200 whose run failed.
type engineError struct {
	NodeID    *string `json:"node_id"`
	Type      *string `json:"type"`
	Message   *string `json:"message"`
	Traceback *string `json:"traceback"`
}

// formattedFailure is a classified failure ready to throw.
type formattedFailure struct {
	message   string
	source    string
	rawDetail string
}

type errorEnvelope struct {
	code           string
	detail         string
	hasDetail      bool
	isLegacyDetail bool
}

func parseErrorEnvelope(rawBody string) errorEnvelope {
	var parsed any
	if json.Unmarshal([]byte(rawBody), &parsed) != nil {
		return errorEnvelope{}
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		return errorEnvelope{}
	}
	if herr, isHerr := obj["error"].(map[string]any); isHerr {
		if code, hasCode := herr["type"].(string); hasCode {
			detail, hasDetail := asDetailString(herr["message"])
			return errorEnvelope{code: code, detail: detail, hasDetail: hasDetail}
		}
	}
	if d, has := obj["detail"]; has {
		detail, hasDetail := asDetailString(d)
		return errorEnvelope{detail: detail, hasDetail: hasDetail, isLegacyDetail: true}
	}
	return errorEnvelope{}
}

func asDetailString(v any) (string, bool) {
	switch t := v.(type) {
	case nil:
		return "", false
	case string:
		return t, t != ""
	}
	b, _ := json.Marshal(v)
	return string(b), true
}

func classifyHTTPFailure(status int, env errorEnvelope) string {
	if env.code != "" {
		if customerFaultHerrCodes[env.code] {
			return sourceUserCode
		}
		return sourceNLPService
	}
	if env.isLegacyDetail && status == 500 && env.hasDetail {
		return sourceUserCode
	}
	return sourceNLPService
}

// cleanErrorDetail strips noise and escapes, collapses blank runs, caps length.
func cleanErrorDetail(raw string) string {
	cleaned := ansiEscape.ReplaceAllString(raw, "")
	cleaned = engineHarnessFrame.ReplaceAllString(cleaned, "")
	for _, p := range noisePatterns {
		cleaned = p.ReplaceAllString(cleaned, "")
	}
	cleaned = strings.TrimSpace(blankRuns.ReplaceAllString(cleaned, "\n\n"))
	if r := []rune(cleaned); len(r) > maxDetailLength {
		cleaned = string(r[:maxDetailLength]) + fmt.Sprintf("\n... (truncated, original was %d chars)", len(r))
	}
	return cleaned
}

func renderUserCodeFailure(statusLine, detail string) string {
	return strings.Join([]string{
		"SerializedCodeAgentAdapter: user code raised an error during execution.",
		"  " + statusLine,
		"  user code error:",
		indent(detail, "    "),
	}, "\n")
}

func renderServiceFailure(headline, detail string) string {
	body := redactInternalAddresses(detail)
	if body == "" {
		body = "(empty)"
	}
	return strings.Join([]string{headline, "  body:", indent(body, "    ")}, "\n")
}

func formatEngineError(e *engineError) formattedFailure {
	if e == nil {
		return formattedFailure{
			source: sourceNLPService,
			message: renderServiceFailure(
				"SerializedCodeAgentAdapter: NLP service reported a failed run without an error body.", ""),
		}
	}
	source := sourceUserCode
	if e.Type != nil && platformEngineErrorTypes[*e.Type] {
		source = sourceNLPService
	}
	raw := firstOf(e.Traceback, e.Message, e.Type)
	cleaned := cleanErrorDetail(raw)
	label := "type: unknown"
	if e.Type != nil && *e.Type != "" {
		label = "type: " + *e.Type
	}
	if source == sourceUserCode {
		return formattedFailure{source: source, rawDetail: raw, message: renderUserCodeFailure(label, cleaned)}
	}
	return formattedFailure{source: source, rawDetail: raw, message: renderServiceFailure(
		"SerializedCodeAgentAdapter: NLP service failed while running the workflow.", cleaned)}
}

func firstOf(values ...*string) string {
	for _, v := range values {
		if v != nil {
			return *v
		}
	}
	return ""
}

func formatHTTPError(status int, rawBody string) formattedFailure {
	env := parseErrorEnvelope(rawBody)
	source := classifyHTTPFailure(status, env)
	raw := rawBody
	if env.hasDetail {
		raw = env.detail
	}
	cleaned := cleanErrorDetail(raw)
	if source == sourceUserCode {
		return formattedFailure{source: source, rawDetail: raw, message: renderUserCodeFailure(fmt.Sprintf("status: %d", status), cleaned)}
	}
	return formattedFailure{source: source, rawDetail: raw, message: renderServiceFailure(
		fmt.Sprintf("SerializedCodeAgentAdapter: NLP service returned HTTP %d.", status), cleaned)}
}

func formatMalformedBodyError(status int, rawBody string) formattedFailure {
	return formattedFailure{source: sourceNLPService, rawDetail: rawBody, message: renderServiceFailure(
		fmt.Sprintf("SerializedCodeAgentAdapter: NLP service returned HTTP %d with a body that is not valid JSON.", status),
		cleanErrorDetail(rawBody))}
}

// formatFetchError words a failure to reach the engine.
func formatFetchError(cause error, timedOutAfterMs int) string {
	if timedOutAfterMs > 0 {
		return fmt.Sprintf("SerializedCodeAgentAdapter: NLP service did not respond within %dms (request aborted).", timedOutAfterMs)
	}
	return "SerializedCodeAgentAdapter: failed to reach NLP service.\n  cause: " + redactInternalAddresses(cause.Error())
}

// redactInternalAddresses removes URLs, IPs and host:port pairs.
func redactInternalAddresses(text string) string {
	text = urlPattern.ReplaceAllString(text, "[redacted]")
	text = ipAddress.ReplaceAllString(text, "[redacted]")
	var b strings.Builder
	last := 0
	for _, loc := range tokenWithPort.FindAllStringIndex(text, -1) {
		match := text[loc[0]:loc[1]]
		followedByAddress := loc[1] < len(text) && strings.IndexByte(".:0123456789", text[loc[1]]) >= 0
		if followedByAddress || !looksLikeHostPort(match) {
			continue
		}
		b.WriteString(text[last:loc[0]])
		b.WriteString("[redacted]")
		last = loc[1]
	}
	b.WriteString(text[last:])
	return b.String()
}

func looksLikeHostPort(match string) bool {
	host := match[:strings.LastIndex(match, ":")]
	if !hostChars.MatchString(host) || digitsAndDots.MatchString(host) {
		return false
	}
	return !sourceFileSuffix.MatchString(host)
}

func indent(text, prefix string) string {
	lines := strings.Split(text, "\n")
	for i, l := range lines {
		lines[i] = prefix + l
	}
	return strings.Join(lines, "\n")
}
