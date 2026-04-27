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
	sel := mustEntrySel(t, `"second"`)
	_, err := dataset.SelectByEntry(rows, sel, nil)
	require.Error(t, err)
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
