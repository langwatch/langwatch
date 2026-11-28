package ciguard_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ciguard"
)

const sharedStages = "FROM distroless AS python-runtime\nFROM python-runtime AS service\nCOPY --from=go-build --chmod=0711 /out/service /usr/local/bin/service\n"

// @scenario "only the Lambda image ships the code-block interpreter execute-only"
func TestExecOnlyInterpreter(t *testing.T) {
	cases := []struct {
		name       string
		dockerfile string
		want       string
	}{
		{
			name:       "the lambda stage alone ships it execute-only",
			dockerfile: sharedStages + "FROM service AS lambda\nCOPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/python3.11\nFROM service AS gateway\n",
		},
		{
			name:       "the shared service stage ships it execute-only",
			dockerfile: sharedStages + "COPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/python3.11\nFROM service AS lambda\nCOPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/python3.11\n",
			want:       `stage "service" ships the interpreter execute-only`,
		},
		{
			name:       "a copy into a directory",
			dockerfile: sharedStages + "COPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/\nFROM service AS lambda\nCOPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/python3.11\n",
			want:       `stage "service" ships the interpreter execute-only`,
		},
		{
			name:       "a copy over continued lines",
			dockerfile: sharedStages + "COPY --from=python-runtime --chmod=0711 \\\n    /usr/bin/python3.11 /usr/bin/python3.11\nFROM service AS lambda\nCOPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/python3.11\n",
			want:       `stage "service" ships the interpreter execute-only`,
		},
		{
			name:       "a RUN chmod",
			dockerfile: sharedStages + "RUN chmod 711 /usr/bin/python3.11\nFROM service AS lambda\nCOPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/python3.11\n",
			want:       `stage "service" ships the interpreter execute-only`,
		},
		{
			name:       "a symbolic RUN chmod",
			dockerfile: sharedStages + "RUN chmod go-r /usr/bin/python3.11\nFROM service AS lambda\nCOPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/python3.11\n",
			want:       `stage "service" ships the interpreter execute-only`,
		},
		{
			name:       "the lambda stage copies it execute-only, then readable again",
			dockerfile: sharedStages + "FROM service AS lambda\nCOPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/python3.11\nCOPY --from=python-runtime /usr/bin/python3.11 /usr/bin/python3.11\n",
			want:       "the lambda stage does not ship the interpreter execute-only",
		},
		{
			name:       "the lambda stage leaves it unrunnable",
			dockerfile: sharedStages + "FROM service AS lambda\nCOPY --from=python-runtime --chmod=0000 /usr/bin/python3.11 /usr/bin/python3.11\n",
			want:       "the lambda stage does not ship the interpreter execute-only",
		},
		{
			name:       "a stage built on an execute-only one inherits it",
			dockerfile: sharedStages + "FROM service AS lambda\nCOPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/python3.11\nFROM lambda AS extra\n",
			want:       `stage "extra" ships the interpreter execute-only`,
		},
		{
			name:       "a readable RUN chmod is fine",
			dockerfile: sharedStages + "RUN chmod 755 /usr/bin/python3.11\nFROM service AS lambda\nCOPY --from=python-runtime --chmod=0711 /usr/bin/python3.11 /usr/bin/python3.11\n",
		},
		{
			name:       "the lambda stage leaves it readable",
			dockerfile: sharedStages + "FROM service AS lambda\nCOPY --from=python-runtime --chmod=0755 /usr/bin/python3.11 /usr/bin/python3.11\n",
			want:       "the lambda stage does not ship the interpreter execute-only",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems, err := ciguard.ExecOnlyInterpreter(goRepo(t, tc.dockerfile))
			require.NoError(t, err)
			if tc.want == "" {
				assert.Empty(t, problems)
				return
			}
			require.Len(t, problems, 1)
			assert.Contains(t, problems[0], tc.want)
		})
	}
}

func TestExecOnlyInterpreterHoldsOnTheRepository(t *testing.T) {
	problems, err := ciguard.ExecOnlyInterpreter("../..")
	require.NoError(t, err)
	assert.Empty(t, problems)
}
