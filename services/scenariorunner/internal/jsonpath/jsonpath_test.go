package jsonpath

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

func doc(t *testing.T) any {
	t.Helper()
	v, err := jsjson.Parse([]byte(`{"choices":[{"message":{"content":"hi"}},{"message":{"content":"bye"}}],"data":{"text":"t","session":{"id":7}},"items":[1,2,3,4]}`))
	require.NoError(t, err)
	return v
}

func TestQuerySelectsTheSubsetHTTPTargetsUse(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"$.choices[0].message.content", `["hi"]`},
		{"choices[1].message.content", `["bye"]`},
		{"$['data']['text']", `["t"]`},
		{"$.data.session", `[{"id":7}]`},
		{"$..content", `["hi","bye"]`},
		{"$.choices[*].message.content", `["hi","bye"]`},
		{"$.items[-1]", `[4]`},
		{"$.items[1:3]", `[2,3]`},
		{"$.items[0,2]", `[1,3]`},
		{"$.missing", `[]`},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			got, err := Query(tc.path, doc(t))
			require.NoError(t, err)
			if got == nil {
				got = []any{}
			}
			assert.Equal(t, tc.want, jsjson.Stringify(got))
		})
	}
}

func TestQueryRefusesFilterExpressions(t *testing.T) {
	_, err := Query("$.items[?(@ > 1)]", doc(t))
	require.ErrorIs(t, err, ErrUnsupported)
}

func TestQueryRefusesAnUnclosedBracket(t *testing.T) {
	_, err := Query("$.items[0", doc(t))
	require.Error(t, err)
}
