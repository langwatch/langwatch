package diffkit

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// signatureWidth caps a normalised message, so one long stack is one signature.
const signatureWidth = 220

var (
	logTimestamp  = regexp.MustCompile(`^\S+Z\s+`)
	varyingPart   = regexp.MustCompile(`\b[0-9a-f]{8,}\b|\b\d+(\.\d+)?(ms|s)?\b|[A-Za-z0-9_-]{21}\b`)
	plainLevel    = regexp.MustCompile(`\b(WARN|ERROR|FATAL|warn|error|fatal)\b`)
	quietLevel    = regexp.MustCompile(`\binfo\b|\bdebug\b`)
	bracketPrefix = regexp.MustCompile(`^\[[^\]]*\]\s*`)
)

// LogLevelMessage reads one log line's level and message, or "" for a line
// below warn. It reads pino JSON (40/50/60 or a level name) and plain text.
func LogLevelMessage(line string) (string, string) {
	body := ansiEscape.ReplaceAllString(logTimestamp.ReplaceAllString(strings.TrimRight(line, "\r\n"), ""), "")
	if strings.HasPrefix(body, "{") {
		return jsonLevelMessage(body)
	}
	match := plainLevel.FindStringSubmatch(body)
	if match == nil || quietLevel.MatchString(body[:min(40, len(body))]) {
		return "", ""
	}
	message, _, _ := strings.Cut(body, ` {"`)
	return strings.ToLower(match[1]), bracketPrefix.ReplaceAllString(message, "")
}

func jsonLevelMessage(body string) (string, string) {
	var entry map[string]any
	if json.Unmarshal([]byte(body), &entry) != nil {
		return "", ""
	}
	level := fmt.Sprint(entry["level"])
	level = map[string]string{"40": "warn", "50": "error", "60": "fatal"}[level] + map[string]string{"warn": "warn", "error": "error", "fatal": "fatal"}[level]
	if level == "" {
		return "", ""
	}
	message := fmt.Sprintf("%v: %v", valueOr(entry["name"]), valueOr(entry["msg"]))
	failure := entry["err"]
	if failure == nil {
		failure = entry["error"]
	}
	if nested, ok := failure.(map[string]any); ok {
		failure = nested["message"]
	}
	if failure != nil {
		message += fmt.Sprintf(" | %v", failure)
	}
	return level, message
}

func valueOr(value any) any {
	if value == nil {
		return ""
	}
	return value
}

// NormaliseSignature masks ids, hashes, numbers and durations, so one shape is one signature.
func NormaliseSignature(message string) string {
	masked := varyingPart.ReplaceAllString(message, "#")
	return masked[:min(signatureWidth, len(masked))]
}

var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;?]*[A-Za-z]`)
