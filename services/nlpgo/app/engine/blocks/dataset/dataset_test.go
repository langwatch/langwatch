package dataset_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/dataset"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

func TestMaterialize_HappyPath(t *testing.T) {
	ds := &dsl.DatasetInline{
		Records: map[string][]any{
			"input":           {"a", "b", "c"},
			"expected_output": {"x", "y", "z"},
			"id":              {float64(1), float64(2), float64(3)},
		},
		ColumnTypes: []dsl.DatasetColumn{
			{Name: "id", Type: dsl.FieldTypeInt},
		},
	}
	rows, err := dataset.Materialize(ds)
	require.NoError(t, err)
	require.Len(t, rows, 3)
	assert.Equal(t, "a", rows[0]["input"])
	assert.Equal(t, "x", rows[0]["expected_output"])
	assert.Equal(t, int64(1), rows[0]["id"])
	assert.Equal(t, int64(3), rows[2]["id"])
}

func TestMaterialize_RejectsColumnLengthMismatch(t *testing.T) {
	ds := &dsl.DatasetInline{
		Records: map[string][]any{
			"a": {1, 2, 3},
			"b": {4, 5},
		},
	}
	_, err := dataset.Materialize(ds)
	require.Error(t, err)
	var mm *dataset.ColumnMismatchError
	require.True(t, errors.As(err, &mm))
}

func TestMaterialize_EmptyDataset(t *testing.T) {
	rows, err := dataset.Materialize(&dsl.DatasetInline{Records: nil})
	require.NoError(t, err)
	assert.Empty(t, rows)
}

func TestSplitRecords_DeterministicForSameSeed(t *testing.T) {
	rows := makeRows(100)
	a, err := dataset.SplitRecords(rows, 0.8, 0.2, 42)
	require.NoError(t, err)
	b, err := dataset.SplitRecords(rows, 0.8, 0.2, 42)
	require.NoError(t, err)
	require.Len(t, a.Train, 80)
	require.Len(t, a.Test, 20)
	assert.Equal(t, a.Train, b.Train, "same seed must produce same train order")
	assert.Equal(t, a.Test, b.Test, "same seed must produce same test order")
}

func TestSplitRecords_DifferentSeedsDifferOnLargeDataset(t *testing.T) {
	rows := makeRows(100)
	a, err := dataset.SplitRecords(rows, 0.5, 0.5, 1)
	require.NoError(t, err)
	b, err := dataset.SplitRecords(rows, 0.5, 0.5, 2)
	require.NoError(t, err)
	assert.NotEqual(t, a.Train, b.Train, "different seeds should yield different orderings on n=100")
}

func TestSplitRecords_RejectsOversize(t *testing.T) {
	rows := makeRows(10)
	_, err := dataset.SplitRecords(rows, 0.8, 0.5, 1)
	require.Error(t, err)
	var bad *dataset.SplitInvalidError
	require.True(t, errors.As(err, &bad))
}

func TestSelectByEntry_Int(t *testing.T) {
	rows := makeRows(5)
	sel := mustEntrySel(t, `1`)
	row, err := dataset.SelectByEntry(rows, sel, nil)
	require.NoError(t, err)
	assert.Equal(t, 1, row["i"])
}

func TestSelectByEntry_OutOfRange(t *testing.T) {
	rows := makeRows(3)
	sel := mustEntrySel(t, `10`)
	_, err := dataset.SelectByEntry(rows, sel, nil)
	require.Error(t, err)
	var bad *dataset.EntrySelectionInvalidError
	require.True(t, errors.As(err, &bad))
	assert.Equal(t, "entry_selection_out_of_range", bad.Reason)
}

func TestSelectByEntry_StringWithLookup(t *testing.T) {
	rows := makeRows(3)
	sel := mustEntrySel(t, `"second"`)
	row, err := dataset.SelectByEntry(rows, sel, func(rs dataset.Records, name string) (int, bool) {
		if name == "second" {
			return 1, true
		}
		return -1, false
	})
	require.NoError(t, err)
	assert.Equal(t, 1, row["i"])
}

func TestSelectByEntry_StringWithoutLookup(t *testing.T) {
	rows := makeRows(3)
	// Arbitrary column name (not a Studio mode keyword) without a byString
	// callback errors — preserves the column-name lookup contract for
	// workflows that rely on a custom resolver.
	sel := mustEntrySel(t, `"second"`)
	_, err := dataset.SelectByEntry(rows, sel, nil)
	require.Error(t, err)
	var bad *dataset.EntrySelectionInvalidError
	require.True(t, errors.As(err, &bad))
	assert.Equal(t, "string_selection_lookup_not_provided", bad.Reason)
}

// Studio's default workflows ship with entry_selection: "first" / "last"
// / "random" / "all" (per optimization_studio/types/dsl.ts). Pre-fix
// nlpgo (commit 392b9f743 was the cap) routed every string through the
// byString fallback and 1ms-failed every execute_flow with the default
// dataset because runEntry passes byString=nil. Python's
// get_dataset_entry_selection has always treated these strings as
// selection MODES, not column names — these tests pin that parity.
func TestSelectByEntry_ModeKeyword_First(t *testing.T) {
	rows := makeRows(3)
	sel := mustEntrySel(t, `"first"`)
	row, err := dataset.SelectByEntry(rows, sel, nil)
	require.NoError(t, err)
	assert.Equal(t, 0, row["i"])
}

func TestSelectByEntry_ModeKeyword_Last(t *testing.T) {
	rows := makeRows(3)
	sel := mustEntrySel(t, `"last"`)
	row, err := dataset.SelectByEntry(rows, sel, nil)
	require.NoError(t, err)
	assert.Equal(t, 2, row["i"])
}

func TestSelectByEntry_ModeKeyword_Random(t *testing.T) {
	rows := makeRows(3)
	sel := mustEntrySel(t, `"random"`)
	row, err := dataset.SelectByEntry(rows, sel, nil)
	require.NoError(t, err)
	// Random — value just has to be one of the rows.
	got, ok := row["i"].(int)
	require.True(t, ok)
	assert.True(t, got >= 0 && got < 3, "random pick must land within rows")
}

func TestSelectByEntry_ModeKeyword_All_PicksFirst(t *testing.T) {
	// "all" + sync execute path returns row 0. The SSE batch path
	// iterates rows above this layer, so SelectByEntry's job is
	// "give me one row" — Python's execute_sync defaults to row 0
	// when no per-row index is set. Verify parity.
	rows := makeRows(3)
	sel := mustEntrySel(t, `"all"`)
	row, err := dataset.SelectByEntry(rows, sel, nil)
	require.NoError(t, err)
	assert.Equal(t, 0, row["i"])
}

func TestSelectByEntry_ModeKeyword_EmptyDataset(t *testing.T) {
	// Empty dataset + mode keyword errors with a dedicated reason so
	// runEntry can surface it as a structured node error rather than a
	// silent panic on the rand.IntN(0) (which would crash the whole
	// stream goroutine).
	cases := []string{"first", "last", "random", "all"}
	for _, mode := range cases {
		t.Run(mode, func(t *testing.T) {
			sel := mustEntrySel(t, `"`+mode+`"`)
			_, err := dataset.SelectByEntry(nil, sel, nil)
			require.Error(t, err)
			var bad *dataset.EntrySelectionInvalidError
			require.True(t, errors.As(err, &bad))
			assert.Equal(t, "entry_selection_empty_dataset", bad.Reason)
		})
	}
}

// TestSelectByEntry_ModeKeywords_BypassByString locks the byString
// short-circuit: even when a column-name resolver is wired, the four
// Studio mode keywords MUST take precedence. Reversing the precedence
// would break customer workflows whose datasets happen to declare a
// column named "first" / "last" / "random" / "all".
func TestSelectByEntry_ModeKeywords_BypassByString(t *testing.T) {
	rows := makeRows(3)
	called := false
	byString := func(rs dataset.Records, name string) (int, bool) {
		called = true
		return 999, true // would crash if used
	}
	sel := mustEntrySel(t, `"first"`)
	row, err := dataset.SelectByEntry(rows, sel, byString)
	require.NoError(t, err)
	assert.Equal(t, 0, row["i"])
	assert.False(t, called, "mode keywords must short-circuit before byString fallback")
}

func TestSelectByEntry_Unset(t *testing.T) {
	rows := makeRows(3)
	_, err := dataset.SelectByEntry(rows, nil, nil)
	require.Error(t, err)
}

func makeRows(n int) dataset.Records {
	out := make(dataset.Records, n)
	for i := 0; i < n; i++ {
		out[i] = map[string]any{"i": i}
	}
	return out
}

func mustEntrySel(t *testing.T, raw string) *dsl.EntrySelection {
	t.Helper()
	var sel dsl.EntrySelection
	require.NoError(t, sel.UnmarshalJSON([]byte(raw)))
	return &sel
}
