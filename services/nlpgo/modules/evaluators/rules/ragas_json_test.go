package rules

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The cases are the reference's verified behaviors (§2.3).
func TestRagasParsingIsAsLenientAsLangchainAndPydantic(t *testing.T) {
	assert.JSONEq(t, `{"a": [1]}`, RagasExtractJSON("Sure! ```json\n{\"a\": [1]} trailing"))
	assert.Equal(t, `[1, [2]]`, RagasExtractJSON(`x [1, [2]] {"b": 1}`))
	assert.Equal(t, "no json here", RagasExtractJSON("no json here"))

	answers := RagasGenerateAnswersPrompt()
	parsed, err := answers.Parse(`{"answers": ["1","0"`)
	require.NoError(t, err, "truncated JSON is closed")
	assert.JSONEq(t, `{"answers": ["1", "0"]}`, string(parsed))
	_, err = answers.Parse(`{"answers": [1, 0]}`)
	require.Error(t, err, "a str field refuses numbers")
	_, err = answers.Parse(`{"answers": ["1",],}`)
	require.Error(t, err, "a trailing comma fails")
	_, err = answers.Parse(`{'answers': ['1']}`)
	require.Error(t, err, "single quotes fail")

	rubrics := RagasRubricsPrompt()
	for _, score := range []string{`4`, `"4"`, `4.0`} {
		parsed, err = rubrics.Parse(`{"feedback": "ok", "score": ` + score + `}`)
		require.NoError(t, err, score)
		var out struct{ Score int64 }
		require.NoError(t, json.Unmarshal(parsed, &out))
		assert.Equal(t, int64(4), out.Score)
	}
	_, err = rubrics.Parse(`{"feedback": "ok", "score": 4.5}`)
	require.Error(t, err)

	parsed, err = RagasSQLEquivalencePrompt().Parse(`{"response_query_explaination": "a", "reference_query_explaination": "b", "equivalence": "yes"}`)
	require.NoError(t, err)
	assert.Contains(t, string(parsed), `"equivalence":true`)
}

func TestRagasRenderDumpsInputAsPydantic(t *testing.T) {
	rendered := RagasRubricsPrompt().Render([]RagasField{
		{Name: "user_input", Value: "a \"q\" <b> é\n"},
		{Name: "reference", Value: nil},
		{Name: "claims", Value: []string{}},
		{Name: "rubrics", Value: []RagasField{{Name: "score1_description", Value: "x"}}},
	})
	assert.Contains(t, rendered, "input: {\n    \"user_input\": \"a \\\"q\\\" <b> é\\n\",\n    \"claims\": [],\n    \"rubrics\": {\n        \"score1_description\": \"x\"\n    }\n}\nOutput: ")
}
