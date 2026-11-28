package ciguard_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ciguard"
)

const lambdaStage = "FROM base AS service\nFROM service AS lambda\n"

// @scenario "on AWS Lambda, the web adapter starts without the role's credentials"
func TestLambdaExtensions(t *testing.T) {
	cases := []struct {
		name       string
		dockerfile string
		want       string
	}{
		{
			name:       "a readable launcher and an execute-only adapter",
			dockerfile: lambdaStage + "COPY --from=go-build --chmod=0755 /out/lambda-extension /opt/extensions/lambda-adapter\nCOPY --from=lambda-adapter --chmod=0711 /lambda-adapter /opt/lwa/lambda-adapter\n",
		},
		{
			name:       "an execute-only extension Lambda cannot start",
			dockerfile: lambdaStage + "COPY --from=lambda-adapter --chmod=0711 /lambda-adapter /opt/extensions/lambda-adapter\nCOPY --from=lambda-adapter --chmod=0711 /lambda-adapter /opt/lwa/lambda-adapter\n",
			want:       "Lambda must read an extension to start it",
		},
		{
			name:       "a readable adapter",
			dockerfile: lambdaStage + "COPY --from=go-build --chmod=0755 /out/lambda-extension /opt/extensions/lambda-adapter\nCOPY --from=lambda-adapter --chmod=0755 /lambda-adapter /opt/lwa/lambda-adapter\n",
			want:       "must be execute-only",
		},
		{
			name:       "no adapter behind the launcher",
			dockerfile: lambdaStage + "COPY --from=go-build --chmod=0755 /out/lambda-extension /opt/extensions/lambda-adapter\n",
			want:       "does not ship the web adapter",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems, err := ciguard.LambdaExtensions(goRepo(t, tc.dockerfile))
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

func TestLambdaExtensionsHoldOnTheRepository(t *testing.T) {
	problems, err := ciguard.LambdaExtensions("../..")
	require.NoError(t, err)
	assert.Empty(t, problems)
}
