package rules

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

// @scenario "A judge answering a score that is not a finite number is an entry error"
func TestJudgeFloatRefusesNonFiniteNumbers(t *testing.T) {
	for _, value := range []any{"NaN", "nan", " inf ", "-Infinity", "+Inf", json.Number("1e400")} {
		_, ok := JudgeFloat(value)
		assert.False(t, ok, "%v", value)
	}
	for value, want := range map[any]float64{"0.75": 0.75, json.Number("1"): 1, true: 1, " -2.5 ": -2.5} {
		got, ok := JudgeFloat(value)
		assert.True(t, ok, "%v", value)
		assert.InDelta(t, want, got, 1e-15, "%v", value)
	}
}
