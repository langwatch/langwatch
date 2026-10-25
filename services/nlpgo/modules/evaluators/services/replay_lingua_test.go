package services_test

import (
	"errors"
	"io/fs"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	lingua "github.com/langwatch/langwatch/services/third_party/lingua-go"
)

// linguaModels is what `make lingua-models` writes; CI generates it first.
const linguaModels = "../../../../third_party/lingua-go/models.bin"

// @scenario "Language detection answers as langevals answered, including Indic scripts and mixed Korean and English"
func TestReplayLanguageDetectionAnswersWhatLangevalsAnswered(t *testing.T) {
	if _, err := os.Stat(linguaModels); errors.Is(err, fs.ErrNotExist) && os.Getenv("CI") == "" {
		t.Skip("run `make lingua-models` to replay language detection")
	}
	require.NoError(t, lingua.LoadModels(linguaModels))
	replayFixtures(t, "lingua/language_detection", "lingua__language_detection.json", replayOptions{Tolerance: 1e-9})
}
