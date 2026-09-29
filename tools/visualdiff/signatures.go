package visualdiff

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// SignaturesFile groups every warn/error/fatal line the stacks logged by its
// shape, split into new-on-the-candidate and also-on-the-base.
const SignaturesFile = "signatures.md"

// signatureWidth caps a normalised message, so one long stack is one signature.
const signatureWidth = 220

var (
	logTimestamp  = regexp.MustCompile(`^\S+Z\s+`)
	varyingPart   = regexp.MustCompile(`\b[0-9a-f]{8,}\b|\b\d+(\.\d+)?(ms|s)?\b|[A-Za-z0-9_-]{21}\b`)
	plainLevel    = regexp.MustCompile(`\b(WARN|ERROR|FATAL|warn|error|fatal)\b`)
	quietLevel    = regexp.MustCompile(`\binfo\b|\bdebug\b`)
	bracketPrefix = regexp.MustCompile(`^\[[^\]]*\]\s*`)
)

// Signature is one log line shape and where it was seen.
type Signature struct {
	Level   string
	Message string
	Count   int
	Sides   map[string]bool
	First   string
}

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

// ScanSignatures reads every log under dir; a file's side is its name up to the first dash.
func ScanSignatures(dir string) ([]Signature, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.log"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	index := map[string]*Signature{}
	var order []string
	for _, path := range paths {
		side, _, _ := strings.Cut(filepath.Base(path), "-")
		if err := scanLog(path, side, index, &order); err != nil {
			return nil, err
		}
	}
	signatures := make([]Signature, 0, len(order))
	for _, key := range order {
		signatures = append(signatures, *index[key])
	}
	sort.SliceStable(signatures, func(a, b int) bool { return signatures[a].Count > signatures[b].Count })
	return signatures, nil
}

func scanLog(path, side string, index map[string]*Signature, order *[]string) error {
	file, err := os.Open(path) // #nosec G304 -- a log this run wrote.
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for number := 1; scanner.Scan(); number++ {
		level, message := LogLevelMessage(scanner.Text())
		if level == "" {
			continue
		}
		key := level + "\x00" + NormaliseSignature(message)
		signature := index[key]
		if signature == nil {
			signature = &Signature{Level: level, Message: NormaliseSignature(message), Sides: map[string]bool{},
				First: fmt.Sprintf("%s:%d", filepath.Base(path), number)}
			index[key] = signature
			*order = append(*order, key)
		}
		signature.Count++
		signature.Sides[side] = true
	}
	return scanner.Err()
}

// RenderSignatures is signatures.md: new on the candidate, then also on the base, then base only.
func RenderSignatures(signatures []Signature) string {
	sections := []struct {
		title string
		keep  func(Signature) bool
	}{
		{"new on the candidate", func(s Signature) bool { return s.Sides["candidate"] && !s.Sides["base"] }},
		{"also on the base", func(s Signature) bool { return s.Sides["candidate"] && s.Sides["base"] }},
		{"base only", func(s Signature) bool { return !s.Sides["candidate"] }},
	}
	var out strings.Builder
	out.WriteString("# log signatures (count level first-seen | message)\n")
	for _, section := range sections {
		fmt.Fprintf(&out, "\n## %s\n", section.title)
		for _, signature := range signatures {
			if section.keep(signature) {
				fmt.Fprintf(&out, "%5d %-5s %s | %s\n", signature.Count, signature.Level, signature.First, signature.Message)
			}
		}
	}
	return out.String()
}

// WriteSignaturesFile scans <runDir>/logs and writes signatures.md.
func WriteSignaturesFile(runDir string) error {
	signatures, err := ScanSignatures(filepath.Join(runDir, "logs"))
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(runDir, SignaturesFile), []byte(RenderSignatures(signatures)), 0o600)
}
