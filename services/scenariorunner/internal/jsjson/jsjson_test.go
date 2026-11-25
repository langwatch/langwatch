package jsjson

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStringifyMatchesJSONStringify(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want string
	}{
		{"keeps insertion order", NewObject().Set("z", 1.0).Set("a", "x"), `{"z":1,"a":"x"}`},
		{"replacing a key keeps its first place", NewObject().Set("a", 1.0).Set("b", 2.0).Set("a", 3.0), `{"a":3,"b":2}`},
		{"undefined members are left out", NewObject().Set("a", Undefined{}).Set("b", nil), `{"b":null}`},
		{"html characters are not escaped", "<a href='x'>&</a>", `"<a href='x'>&</a>"`},
		{"control characters use short escapes", "a\nb\tc\u0001", `"a\nb\tc\u0001"`},
		{"line separators are written raw", "a b", "\"a b\""},
		{"integers print without a fraction", 100.0, `100`},
		{"fractions print shortest", 0.1, `0.1`},
		{"large numbers switch to exponent form", 1e21, `1e+21`},
		{"small numbers switch to exponent form", 1e-7, `1e-7`},
		{"raw JSON is written verbatim", []any{Raw(`{"x":1}`)}, `[{"x":1}]`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, Stringify(tc.in))
		})
	}
}

func TestParseKeepsKeyOrderAndRoundTrips(t *testing.T) {
	src := `{"b":{"y":[1,2.5,"s"],"x":true},"a":null}`
	v, err := Parse([]byte(src))
	require.NoError(t, err)
	assert.Equal(t, src, Stringify(v))
}

func TestParseRefusesTrailingData(t *testing.T) {
	_, err := Parse([]byte(`{"a":1} {"b":2}`))
	require.Error(t, err)
}

func TestToTextKeepsStringsAndStringifiesTheRest(t *testing.T) {
	assert.Equal(t, "hello", ToText("hello"))
	assert.Equal(t, `{"a":1}`, ToText(NewObject().Set("a", 1.0)))
	assert.Equal(t, "null", ToText(nil))
}
