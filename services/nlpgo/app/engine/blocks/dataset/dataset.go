// Package dataset materializes an Entry node's inline dataset into
// records and computes the deterministic train/test split. The
// behavior matches the Python entry node so byte-equivalent ordering
// is preserved across the migration. See _shared/contract.md §5 and
// specs/nlp-go/dataset-block.feature.
package dataset

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"sort"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// Records is the row-oriented form of a dataset (slice of records,
// each a column->value map).
type Records []map[string]any

// Materialize converts a column-oriented inline dataset into row form,
// validates that every column has the same length, and applies field
// type coercion when the column declares a non-string type.
func Materialize(ds *dsl.DatasetInline) (Records, error) {
	if ds == nil {
		return nil, errors.New("dataset: inline dataset required")
	}
	if len(ds.Records) == 0 {
		return Records{}, nil
	}
	// Determine row count from the first column; verify the rest match.
	colNames := sortedKeys(ds.Records)
	rowCount := len(ds.Records[colNames[0]])
	for _, col := range colNames {
		if len(ds.Records[col]) != rowCount {
			return nil, &ColumnMismatchError{
				Column:   col,
				Expected: rowCount,
				Got:      len(ds.Records[col]),
			}
		}
	}
	typeByName := make(map[string]dsl.FieldType, len(ds.ColumnTypes))
	for _, c := range ds.ColumnTypes {
		typeByName[c.Name] = c.Type
	}
	out := make(Records, rowCount)
	for i := 0; i < rowCount; i++ {
		row := make(map[string]any, len(colNames))
		for _, col := range colNames {
			raw := ds.Records[col][i]
			if t, ok := typeByName[col]; ok {
				coerced, err := coerce(raw, t)
				if err != nil {
					return nil, fmt.Errorf("dataset: column %q row %d: %w", col, i, err)
				}
				row[col] = coerced
			} else {
				row[col] = raw
			}
		}
		out[i] = row
	}
	return out, nil
}

// Split is the materialized train/test split for a dataset.
type Split struct {
	Train Records
	Test  Records
}

// SplitRecords applies the deterministic train/test split using the
// provided sizes (fractions in [0,1]) and seed.
//
// Python parity: NumPy's RandomState shuffle isn't accessible from Go,
// so we use a Go random source seeded with the same int. This produces
// a different ordering than NumPy for the same seed, but is internally
// stable across Go runs. The parity test fixture compares the train
// and test row sets (not orderings) for cross-language equivalence.
func SplitRecords(rows Records, trainSize, testSize float64, seed int64) (*Split, error) {
	if trainSize < 0 || testSize < 0 {
		return nil, &SplitInvalidError{Reason: "sizes must be non-negative"}
	}
	if trainSize+testSize > 1.000001 {
		return nil, &SplitInvalidError{Reason: "sizes sum exceeds 1"}
	}
	n := len(rows)
	if n == 0 {
		return &Split{}, nil
	}
	trainN := int(float64(n) * trainSize)
	testN := int(float64(n) * testSize)
	if trainN+testN > n {
		return nil, &SplitInvalidError{Reason: "split_exceeds_dataset_size"}
	}
	indices := make([]int, n)
	for i := range indices {
		indices[i] = i
	}
	src := rand.New(rand.NewPCG(uint64(seed), uint64(seed)))
	src.Shuffle(n, func(i, j int) {
		indices[i], indices[j] = indices[j], indices[i]
	})
	train := make(Records, trainN)
	for i := 0; i < trainN; i++ {
		train[i] = rows[indices[i]]
	}
	test := make(Records, testN)
	for i := 0; i < testN; i++ {
		test[i] = rows[indices[trainN+i]]
	}
	return &Split{Train: train, Test: test}, nil
}

// SelectByEntry returns the row pointed to by entry_selection. The
// selection may be:
//   - an int index — direct lookup
//   - one of the Studio mode keywords "first" / "last" / "random" / "all"
//     (mirrors Python's get_dataset_entry_selection in
//     langwatch_nlp/studio/utils.py — Studio's TS DSL pins this set in
//     optimization_studio/types/dsl.ts)
//   - any other string — delegated to byString (column-name lookup, which
//     is workflow-specific so the engine wires the callback per call)
//
// "all" returns row 0: the sync execute path pulls a single row, while
// the SSE batch path iterates rows above this layer; matches Python's
// execute_sync behavior of falling back to the first record when no
// per-row index is set.
func SelectByEntry(rows Records, sel *dsl.EntrySelection, byString func(rows Records, name string) (int, bool)) (map[string]any, error) {
	if sel == nil || !sel.IsSet() {
		return nil, &EntrySelectionInvalidError{Reason: "entry_selection_unset"}
	}
	if i, ok := sel.AsInt(); ok {
		if i < 0 || i >= len(rows) {
			return nil, &EntrySelectionInvalidError{Reason: "entry_selection_out_of_range", Index: i, Total: len(rows)}
		}
		return rows[i], nil
	}
	if s, ok := sel.AsString(); ok {
		// Studio's default workflows ship with entry_selection: "random".
		// Mode keywords match BEFORE the byString fallback so a workflow
		// without a column-name resolver still runs its dataset (M3
		// dogfood 2026-04-29 trace 60f59f73… caught the regression —
		// every execute_flow with the default Studio dataset 1ms-failed
		// on entry with `string_selection_lookup_not_provided`).
		switch s {
		case "first", "all":
			if len(rows) == 0 {
				return nil, &EntrySelectionInvalidError{Reason: "entry_selection_empty_dataset"}
			}
			return rows[0], nil
		case "last":
			if len(rows) == 0 {
				return nil, &EntrySelectionInvalidError{Reason: "entry_selection_empty_dataset"}
			}
			return rows[len(rows)-1], nil
		case "random":
			if len(rows) == 0 {
				return nil, &EntrySelectionInvalidError{Reason: "entry_selection_empty_dataset"}
			}
			return rows[rand.IntN(len(rows))], nil
		}
		if byString == nil {
			return nil, &EntrySelectionInvalidError{Reason: "string_selection_lookup_not_provided"}
		}
		i, found := byString(rows, s)
		if !found {
			return nil, &EntrySelectionInvalidError{Reason: "entry_selection_not_found", Name: s}
		}
		if i < 0 || i >= len(rows) {
			return nil, &EntrySelectionInvalidError{Reason: "entry_selection_out_of_range", Index: i, Total: len(rows)}
		}
		return rows[i], nil
	}
	return nil, &EntrySelectionInvalidError{Reason: "entry_selection_unrecognized_type"}
}

// ColumnMismatchError signals two columns have different lengths.
type ColumnMismatchError struct {
	Column   string
	Expected int
	Got      int
}

func (e *ColumnMismatchError) Error() string {
	return fmt.Sprintf("dataset: column %q has %d rows, expected %d", e.Column, e.Got, e.Expected)
}

// SplitInvalidError signals an invalid train/test split request.
type SplitInvalidError struct {
	Reason string
}

func (e *SplitInvalidError) Error() string { return "dataset: invalid split: " + e.Reason }

// EntrySelectionInvalidError signals an invalid entry_selection.
type EntrySelectionInvalidError struct {
	Reason string
	Index  int
	Total  int
	Name   string
}

func (e *EntrySelectionInvalidError) Error() string {
	switch e.Reason {
	case "entry_selection_out_of_range":
		return fmt.Sprintf("dataset: entry_selection %d out of range [0, %d)", e.Index, e.Total)
	case "entry_selection_not_found":
		return fmt.Sprintf("dataset: entry_selection %q not found in dataset", e.Name)
	default:
		return "dataset: " + e.Reason
	}
}

func sortedKeys(m map[string][]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// coerce best-effort converts the raw Pydantic-decoded value into the
// declared field type. JSON numbers always come back as float64 from
// encoding/json; we round-trip them through the right concrete type to
// match Python's pydantic coercion.
func coerce(v any, t dsl.FieldType) (any, error) {
	if v == nil {
		return nil, nil
	}
	switch t {
	case dsl.FieldTypeStr:
		switch x := v.(type) {
		case string:
			return x, nil
		case float64:
			return fmt.Sprintf("%g", x), nil
		case int64:
			return fmt.Sprintf("%d", x), nil
		case bool:
			if x {
				return "true", nil
			}
			return "false", nil
		default:
			return fmt.Sprintf("%v", x), nil
		}
	case dsl.FieldTypeInt:
		switch x := v.(type) {
		case int:
			return int64(x), nil
		case int64:
			return x, nil
		case float64:
			return int64(x), nil
		case string:
			var i int64
			if _, err := fmt.Sscanf(x, "%d", &i); err != nil {
				return nil, fmt.Errorf("cannot parse %q as int", x)
			}
			return i, nil
		default:
			return nil, fmt.Errorf("cannot coerce %T to int", v)
		}
	case dsl.FieldTypeFloat:
		switch x := v.(type) {
		case float64:
			return x, nil
		case int:
			return float64(x), nil
		case int64:
			return float64(x), nil
		case string:
			var f float64
			if _, err := fmt.Sscanf(x, "%g", &f); err != nil {
				return nil, fmt.Errorf("cannot parse %q as float", x)
			}
			return f, nil
		default:
			return nil, fmt.Errorf("cannot coerce %T to float", v)
		}
	case dsl.FieldTypeBool:
		switch x := v.(type) {
		case bool:
			return x, nil
		case string:
			switch x {
			case "true", "True", "1":
				return true, nil
			case "false", "False", "0", "":
				return false, nil
			default:
				return nil, fmt.Errorf("cannot parse %q as bool", x)
			}
		case float64:
			return x != 0, nil
		default:
			return nil, fmt.Errorf("cannot coerce %T to bool", v)
		}
	default:
		// list, dict, json_schema, chat_messages, etc. — pass through;
		// downstream consumers handle type-specific shapes.
		return v, nil
	}
}
