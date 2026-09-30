//go:build lingua_models

package services_test

import "testing"

// @scenario "Language detection answers as langevals answered, including Indic scripts and mixed Korean and English"
func TestReplayLanguageDetectionAnswersWhatLangevalsAnswered(t *testing.T) {
	replayFixtures(t, "lingua/language_detection", "lingua__language_detection.json", replayOptions{Tolerance: 1e-9})
}
