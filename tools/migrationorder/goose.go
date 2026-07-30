package migrationorder

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// SQLFile is one goose migration read as text.
type SQLFile struct {
	// Entry is the file name directly under the set's directory.
	Entry string
	// Body is the file's contents.
	Body string
}

// SQLInput is one goose migration set as it stands in the working tree.
type SQLInput struct {
	Set   Set
	Files []SQLFile
}

// liveDownExceptions are the migrations that ship a live Down block and are
// allowed to keep it, by path.
//
// This list can only shrink. Every entry must still have a live Down block —
// one that has been fixed, or deleted, is reported as stale so the list cannot
// rot into a blanket amnesty, the same ratchet
// platform/app/scripts/check-feature-parity.ts applies to its legacy entries.
//
// Nothing may be added here. Each entry is on main and therefore deployed, and
// that is the only thing that puts it out of reach: a deployed migration is
// immutable history, and editing one is what the ordering check above already
// fails a branch for. A migration still on a branch is fixable, which is the
// entire point of the check.
var liveDownExceptions = []string{
	// Live `DROP INDEX IF EXISTS` on both ngram skip indexes. Rebuildable, but
	// only by re-materializing them across every partition of trace_summaries,
	// which is a background mutation over the whole table rather than a revert.
	"platform/app/src/server/clickhouse/migrations/00011_add_io_search_indexes.sql",

	// Live `MODIFY COLUMN AnnotationIds Array(String)` — the Up added the
	// `DEFAULT []` this Down takes away again. Running it restores exactly the
	// unmaterialized-column corruption the Up exists to fix, the one that
	// throws "Amount of memory requested to allocate is more than allowed" out
	// of a merge, so this Down is worse than irreversible: it reintroduces a
	// known outage.
	"platform/app/src/server/clickhouse/migrations/00014_add_annotation_ids_default.sql",

	// Live `DROP COLUMN IF EXISTS ProviderKey`, with no rollback note. The
	// column is the audit dimension answering which vendor a debit was
	// dispatched to; dropping it discards that for every ledger event ever
	// written, and the ledger is the record spend disputes are settled from.
	"platform/app/src/server/clickhouse/migrations/00059_gateway_budget_ledger_provider_key.sql",
}

// downExample is the migration the failure message points the author at: its
// Down block is commented out, carries the rollback note, and explains why the
// change is irreversible.
const downExample = "00061_trace_analytics_storage_anchor.sql"

// CheckSQL reports the migrations in one goose set that break the rules a
// migration cannot be walked back from.
//
// Every file in the set is judged, not only the ones the branch adds: the
// grandfathered exceptions are what keeps that from failing the tree as it
// stands, and they are visible in this file rather than implied by which files
// a diff happened to touch.
func CheckSQL(in SQLInput) []Finding {
	if !in.Set.Goose {
		return nil
	}

	var findings []Finding
	seen, live := map[string]bool{}, map[string]bool{}

	for _, file := range in.Files {
		path := in.Set.Directory + "/" + file.Entry
		seen[path] = true

		if line, ok := liveDownStatement(file.Body); ok {
			live[path] = true
			if !slices.Contains(liveDownExceptions, path) {
				findings = append(findings, Finding{
					Set:   in.Set.Name,
					Entry: file.Entry,
					Problem: fmt.Sprintf(
						"ships live SQL in its Down block (line %d), so one goose down destroys data — "+
							"comment every statement in the Down section out and leave a note saying to roll back, "+
							"uncomment and run manually, as %s does",
						line, downExample),
				})
			}
		}

		for _, block := range packedBlocks(file.Body) {
			findings = append(findings, Finding{
				Set:   in.Set.Name,
				Entry: file.Entry,
				Problem: fmt.Sprintf(
					"packs %d statements into the goose block at line %d, and ClickHouse runs one statement "+
						"per query — give each statement its own StatementBegin / StatementEnd pair",
					block.statements, block.line),
			})
		}
	}

	// An exception whose file was read and no longer has a live Down block has
	// served its purpose. Reporting it is what stops the list rotting into a
	// blanket amnesty. A file the input did not carry is not judged — this says
	// nothing about it either way.
	for _, path := range liveDownExceptions {
		entry, ok := strings.CutPrefix(path, in.Set.Directory+"/")
		if !ok || !seen[path] || live[path] {
			continue
		}
		findings = append(findings, Finding{
			Set:   in.Set.Name,
			Entry: entry,
			Problem: "is listed as a live Down block that cannot be fixed, but its Down block is no longer " +
				"live — drop it from liveDownExceptions in tools/migrationorder/goose.go, which only shrinks",
		})
	}

	return findings
}

var (
	gooseUp             = regexp.MustCompile(`^--\s*\+goose\s+Up\b`)
	gooseDown           = regexp.MustCompile(`^--\s*\+goose\s+Down\b`)
	gooseStatementBegin = regexp.MustCompile(`^--\s*\+goose\s+StatementBegin\b`)
	gooseStatementEnd   = regexp.MustCompile(`^--\s*\+goose\s+StatementEnd\b`)
)

// liveDownStatement returns the 1-based line of the first live statement in the
// file's Down section, if it has one.
//
// Everything after `-- +goose Down` belongs to the Down section, including the
// StatementBegin / StatementEnd blocks within it — those markers are goose
// annotations written as SQL comments, so they need no special case here, and
// neither does ENVSUB. A line is inert when it is blank or commented with `--`,
// which is the only form the house rule recognizes: a Down block wrapped in
// `/* */` reads as live, deliberately, because the convention every other
// migration follows is line comments.
func liveDownStatement(body string) (int, bool) {
	down := false
	for index, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case gooseDown.MatchString(trimmed):
			down = true
		case gooseUp.MatchString(trimmed):
			down = false
		case !down || trimmed == "" || strings.HasPrefix(trimmed, "--"):
			continue
		default:
			return index + 1, true
		}
	}
	return 0, false
}

type packedBlock struct {
	// line is the 1-based line of the block's StatementBegin.
	line int
	// statements is how many statements the block holds.
	statements int
}

// packedBlocks returns the StatementBegin / StatementEnd blocks that hold more
// than one statement.
//
// ClickHouse takes one statement per query, so a block holding two fails at run
// time rather than at review time. Statements are counted by their terminating
// semicolons; a block's trailing statement counts whether or not it is
// terminated.
//
// One ALTER TABLE with several comma-separated actions is one statement and is
// not reported — sometimes it is the only thing that works, as when ClickHouse
// requires a column be added in the same ALTER that folds it into the sorting
// key.
func packedBlocks(body string) []packedBlock {
	var blocks []packedBlock
	begun := 0
	var live strings.Builder

	flush := func() {
		if statements := statementCount(live.String()); begun != 0 && statements > 1 {
			blocks = append(blocks, packedBlock{line: begun, statements: statements})
		}
		begun = 0
		live.Reset()
	}

	for index, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case gooseStatementBegin.MatchString(trimmed):
			flush()
			begun = index + 1
		case gooseStatementEnd.MatchString(trimmed):
			flush()
		case begun == 0 || trimmed == "" || strings.HasPrefix(trimmed, "--"):
			continue
		default:
			live.WriteString(trimmed)
			live.WriteString(" ")
		}
	}
	flush()

	return blocks
}

// statementCount counts the semicolon-terminated statements in sql, plus a
// trailing one if the last statement runs to the end without its semicolon.
func statementCount(sql string) int {
	count := strings.Count(sql, ";")
	if strings.TrimSpace(sql[strings.LastIndex(sql, ";")+1:]) != "" {
		count++
	}
	return count
}

// SQLInputs reads the goose migration sets out of the working tree under the
// repository root.
//
// The working tree rather than a git ref, unlike the ordering check: this rule
// is about the file itself and not about how it compares to another branch, so
// reading what is on disk lets an author run the tool and see the problem
// before committing.
func (r Repo) SQLInputs() ([]SQLInput, error) {
	var inputs []SQLInput
	for _, set := range Sets {
		if !set.Goose {
			continue
		}
		directory := filepath.Join(r.Root, filepath.FromSlash(set.Directory))
		entries, err := os.ReadDir(directory)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		// os.ReadDir sorts by name, so findings come out in migration order.
		var files []SQLFile
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
				continue
			}
			body, err := os.ReadFile(filepath.Join(directory, entry.Name()))
			if err != nil {
				return nil, err
			}
			files = append(files, SQLFile{Entry: entry.Name(), Body: string(body)})
		}
		inputs = append(inputs, SQLInput{Set: set, Files: files})
	}
	return inputs, nil
}
