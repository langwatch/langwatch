package apidiff

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Round-trip verdicts, one per resource in verdict.md.
const (
	verdictWorks      = "works"
	verdictBroken     = "broken"
	verdictBrokenBoth = "broken-both"
	verdictFixed      = "fixed"
	verdictNotRun     = "not-run"
)

// roundTripVerdict is one resource's verdict and the step that decided it.
func roundTripVerdict(effects []Effect) (string, Effect) {
	rules := []struct {
		verdict string
		matches func(Effect) bool
	}{
		{verdictBroken, func(effect Effect) bool { return effect.A.Effect == effectBroken && effect.B.Effect == effectOK }},
		{verdictBrokenBoth, func(effect Effect) bool { return effect.A.Effect == effectBroken && effect.B.Effect == effectBroken }},
		{verdictFixed, func(effect Effect) bool { return effect.B.Effect == effectBroken }},
		{verdictNotRun, func(effect Effect) bool { return effect.A.Effect != effectOK || effect.B.Effect != effectOK }},
	}
	for _, rule := range rules {
		for index := range effects {
			if rule.matches(effects[index]) {
				return rule.verdict, effects[index]
			}
		}
	}
	return verdictWorks, Effect{}
}

// WriteVerdict renders verdict.md, the one file an agent reads first: a line
// per round trip, the first failure under any that did not work, and a count
// of the run's failing findings.
func WriteVerdict(writer io.Writer, report Report, newSignatures int) error {
	var output strings.Builder
	output.WriteString("# apidiff verdict\n\n")
	for _, resource := range effectResources(report.Effects) {
		steps := make([]Effect, 0, len(roundTripSteps))
		for index := range report.Effects {
			if report.Effects[index].Resource == resource {
				steps = append(steps, report.Effects[index])
			}
		}
		verdict, first := roundTripVerdict(steps)
		fmt.Fprintf(&output, "- %s %s\n", verdict, resource)
		if verdict != verdictWorks {
			fmt.Fprintf(&output, "  first failure: %s %s %s; candidate %s; base %s\n",
				first.Step, first.Method, first.Path, sideNote(first.A), sideNote(first.B))
		}
	}
	if len(report.Effects) == 0 {
		output.WriteString("- no round trip ran\n")
	}
	fmt.Fprintf(&output, "\nfailing findings: %d (stdout summary, report JSON)\n", report.Differences)
	if newSignatures >= 0 {
		fmt.Fprintf(&output, "log signatures new on the candidate: %d (signatures.md)\n", newSignatures)
	}
	_, err := io.WriteString(writer, output.String())
	return err
}

func sideNote(side EffectSide) string {
	if side.Detail == "" {
		return side.Effect
	}
	return side.Effect + " (" + side.Detail + ")"
}

// logSignature is one warn-or-worse log message, numbers and ids masked, with
// its count per side and where it first appeared.
type logSignature struct {
	level     string
	message   string
	candidate int
	base      int
	first     string
}

var (
	ansiEscape      = regexp.MustCompile(`\x1b\[[0-9;]*m`)
	leadingStamp    = regexp.MustCompile(`^\S+Z\s+`)
	plainLevel      = regexp.MustCompile(`\b(WARN|ERROR|FATAL|warn|error|fatal)\b`)
	quietLevel      = regexp.MustCompile(`\binfo\b|\bdebug\b`)
	bracketPrefix   = regexp.MustCompile(`^\[[^\]]*\]\s*`)
	signatureNumber = regexp.MustCompile(`\b[0-9a-f]{8,}\b|\b\d+(\.\d+)?(ms|s)?\b|[A-Za-z0-9_-]{21}\b`)
	pinoLevels      = map[float64]string{40: "warn", 50: "error", 60: "fatal"}
)

// logLevelMessage reads one log line: its level and message when it is a
// warning or worse, pino JSON or plain text alike.
func logLevelMessage(line string) (string, string, bool) {
	body := leadingStamp.ReplaceAllString(ansiEscape.ReplaceAllString(strings.TrimRight(line, "\r\n"), ""), "")
	if strings.HasPrefix(body, "{") {
		return pinoLevelMessage(body)
	}
	match := plainLevel.FindString(body)
	head := body
	if len(head) > 40 {
		head = head[:40]
	}
	if match == "" || quietLevel.MatchString(head) {
		return "", "", false
	}
	message, _, _ := strings.Cut(body, ` {"`)
	return strings.ToLower(match), bracketPrefix.ReplaceAllString(message, ""), true
}

func pinoLevelMessage(body string) (string, string, bool) {
	var entry map[string]any
	if json.Unmarshal([]byte(body), &entry) != nil {
		return "", "", false
	}
	level, _ := entry["level"].(string)
	if number, ok := entry["level"].(float64); ok {
		level = pinoLevels[number]
	}
	if level != "warn" && level != "error" && level != "fatal" {
		return "", "", false
	}
	message := fmt.Sprintf("%v: %v", valueOr(entry["name"]), valueOr(entry["msg"]))
	if cause := errorMessage(entry); cause != "" {
		message += " | " + cause
	}
	return level, message, true
}

func valueOr(value any) any {
	if value == nil {
		return ""
	}
	return value
}

func errorMessage(entry map[string]any) string {
	for _, key := range []string{"err", "error"} {
		switch typed := entry[key].(type) {
		case map[string]any:
			if message, ok := typed["message"].(string); ok {
				return message
			}
		case string:
			return typed
		}
	}
	return ""
}

func maskSignature(message string) string {
	masked := signatureNumber.ReplaceAllString(message, "#")
	if len(masked) > 220 {
		return masked[:220]
	}
	return masked
}

// ScanLogSignatures reads every branch* (candidate) and main* (base) log in
// dir and tallies the warn-or-worse signatures.
func ScanLogSignatures(dir string) ([]*logSignature, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	tally := &signatureTally{byKey: map[string]*logSignature{}}
	for _, entry := range entries {
		candidate := strings.HasPrefix(entry.Name(), "branch")
		if entry.IsDir() || (!candidate && !strings.HasPrefix(entry.Name(), "main")) {
			continue
		}
		if err := tally.scan(filepath.Join(dir, entry.Name()), candidate); err != nil {
			return nil, err
		}
	}
	order := tally.order
	sort.SliceStable(order, func(i, j int) bool {
		return order[i].candidate+order[i].base > order[j].candidate+order[j].base
	})
	return order, nil
}

// signatureTally files each signature once, in first-seen order.
type signatureTally struct {
	byKey map[string]*logSignature
	order []*logSignature
}

func (tally *signatureTally) scan(path string, candidate bool) error {
	file, err := os.Open(path) // #nosec G304 -- the run's own log directory
	if err != nil {
		return err
	}
	defer file.Close()
	reader := bufio.NewReader(file)
	for number := 1; ; number++ {
		line, readErr := reader.ReadString('\n')
		if level, message, ok := logLevelMessage(line); ok {
			tally.add(&logSignature{level: level, message: maskSignature(message), first: fmt.Sprintf("%s:%d", filepath.Base(path), number)}, candidate)
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

// add counts one sighting, filing the signature when it is new.
func (tally *signatureTally) add(sighting *logSignature, candidate bool) {
	key := sighting.level + "\x00" + sighting.message
	signature, seen := tally.byKey[key]
	if !seen {
		signature = sighting
		tally.byKey[key] = signature
		tally.order = append(tally.order, signature)
	}
	if candidate {
		signature.candidate++
	} else {
		signature.base++
	}
}

// WriteSignatures renders signatures.md: new on the candidate first, then
// those on both sides, then the base's alone. It answers the new count.
func WriteSignatures(writer io.Writer, signatures []*logSignature) (int, error) {
	sections := []struct {
		title    string
		includes func(*logSignature) bool
	}{
		{"New on candidate", func(signature *logSignature) bool { return signature.base == 0 }},
		{"Also on base", func(signature *logSignature) bool { return signature.base > 0 && signature.candidate > 0 }},
		{"Base only", func(signature *logSignature) bool { return signature.candidate == 0 }},
	}
	var output strings.Builder
	output.WriteString("# log signatures (warn and worse; candidate/base counts)\n")
	newCount := 0
	for index, section := range sections {
		fmt.Fprintf(&output, "\n## %s\n\n", section.title)
		for _, signature := range signatures {
			if !section.includes(signature) {
				continue
			}
			if index == 0 {
				newCount++
			}
			fmt.Fprintf(&output, "- %d/%d %s %s | %s\n", signature.candidate, signature.base, signature.level, signature.first, signature.message)
		}
	}
	_, err := io.WriteString(writer, output.String())
	return newCount, err
}

// writeRunNotes writes signatures.md (when the run kept logs) and verdict.md
// beside the run's probe packets or report file.
func (probe *probeFlags) writeRunNotes(verdict runVerdict, out streams) {
	var dir string
	switch {
	case probe.packetDir != "":
		dir = filepath.Dir(probe.packetDir)
	case probe.reportFile != "":
		dir = filepath.Dir(probe.reportFile)
	default:
		return
	}
	newSignatures := -1
	if signatures, err := ScanLogSignatures(filepath.Join(dir, "logs")); err == nil {
		err = writeTextFile(filepath.Join(dir, "signatures.md"), func(writer io.Writer) error {
			newSignatures, err = WriteSignatures(writer, signatures)
			return err
		})
		if err != nil {
			fmt.Fprintln(out.stderr, "signatures:", err)
		}
	}
	path := filepath.Join(dir, "verdict.md")
	if err := writeTextFile(path, func(writer io.Writer) error { return WriteVerdict(writer, verdict.report, newSignatures) }); err != nil {
		fmt.Fprintln(out.stderr, "verdict:", err)
		return
	}
	fmt.Fprintf(out.stderr, "verdict: %s\n", path)
}

func writeTextFile(path string, write func(io.Writer) error) error {
	return writeJSONFile(path, func(file *os.File) error { return write(file) })
}
