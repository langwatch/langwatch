package visualdiff

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// JudgeFile is the runner's per-edition ledger of judged pairs (runner/src/judge.ts).
const JudgeFile = "judge.json"

// judgeCacheFile is the verdict cache under the repository root; it outlives every run.
func judgeCacheFile(root string) string {
	return filepath.Join(root, ".visualdiff", "judge-cache.json")
}

// judgeFor is the plan's judge when the run asked for one.
func judgeFor(options Options) *RunnerJudge {
	if !options.Judge {
		return nil
	}
	return &RunnerJudge{CacheFile: judgeCacheFile(options.Root)}
}

// JudgeRegression is one regression both of the judge's answers named.
type JudgeRegression struct {
	Kind    string `json:"kind"`
	Element string `json:"element"`
	Message string `json:"message"`
}

// JudgedPair is one flagged pair; Label is its diff file's name without .png.
type JudgedPair struct {
	Label       string            `json:"label"`
	Cached      bool              `json:"cached"`
	Regressions []JudgeRegression `json:"regressions"`
}

// JudgeLedger is judge.json: what one edition's judging cost and found.
type JudgeLedger struct {
	Model        string       `json:"model"`
	Calls        int          `json:"calls"`
	InputTokens  int          `json:"inputTokens"`
	OutputTokens int          `json:"outputTokens"`
	USD          float64      `json:"usd"`
	Cached       int          `json:"cached"`
	Failures     int          `json:"failures"`
	FirstFailure string       `json:"firstFailure"`
	Pairs        []JudgedPair `json:"pairs"`
}

// readJudgeLedgers reads every edition's judge.json under runDir/shots; none is not an error.
func readJudgeLedgers(runDir string) (map[Edition]JudgeLedger, error) {
	ledgers := map[Edition]JudgeLedger{}
	paths, err := filepath.Glob(filepath.Join(runDir, "shots", "*", JudgeFile))
	if err != nil {
		return nil, err
	}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var ledger JudgeLedger
		if err := json.Unmarshal(raw, &ledger); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		ledgers[Edition(filepath.Base(filepath.Dir(path)))] = ledger
	}
	return ledgers, nil
}

// applyJudgements fails a row whose pair the judge found a regression in and
// marks a judged finding with none as judged-harmless; rows is a copy.
func applyJudgements(rows []Row, ledgers map[Edition]JudgeLedger) []Row {
	judged := map[Edition]map[string]JudgedPair{}
	for edition, ledger := range ledgers {
		judged[edition] = map[string]JudgedPair{}
		for _, pair := range ledger.Pairs {
			judged[edition][pair.Label] = pair
		}
	}
	out := append([]Row(nil), rows...)
	for index := range out {
		row := &out[index]
		if row.DiffFile == "" {
			continue
		}
		pair, ok := judged[row.Edition][strings.TrimSuffix(filepath.Base(row.DiffFile), ".png")]
		switch {
		case !ok:
		case len(pair.Regressions) > 0:
			if !brokenClasses[row.Class] {
				row.Class = ClassRegression
			}
			row.Why = "judge: " + judgeReason(pair.Regressions) + "; " + row.Why
		case row.Finding():
			row.Why += " · judged-harmless"
		}
	}
	return out
}

func judgeReason(regressions []JudgeRegression) string {
	reasons := make([]string, 0, len(regressions))
	for _, regression := range regressions {
		reasons = append(reasons, fmt.Sprintf("%s %s: %s", regression.Kind, regression.Element, regression.Message))
	}
	return strings.Join(reasons, " | ")
}

// renderJudgeCost is verdict.md's judge section: one line per edition.
func renderJudgeCost(ledgers map[Edition]JudgeLedger) string {
	if len(ledgers) == 0 {
		return ""
	}
	var out strings.Builder
	out.WriteString("\njudge (agreed regressions fail their screen):\n")
	for _, edition := range sortedEditions(ledgers) {
		ledger := ledgers[edition]
		fmt.Fprintf(&out, "- [%s] %s: %d pairs (%d cached), %d calls, %d in / %d out tokens, $%.4f",
			edition, ledger.Model, len(ledger.Pairs), ledger.Cached, ledger.Calls, ledger.InputTokens, ledger.OutputTokens, ledger.USD)
		if ledger.Failures > 0 {
			fmt.Fprintf(&out, ", %d failed (first: %s)", ledger.Failures, head(ledger.FirstFailure))
		}
		out.WriteString("\n")
	}
	return out.String()
}

func sortedEditions(ledgers map[Edition]JudgeLedger) []Edition {
	editions := make([]Edition, 0, len(ledgers))
	for edition := range ledgers {
		editions = append(editions, edition)
	}
	slices.Sort(editions)
	return editions
}
