//go:build !race

package seedgen

// raceDetector reports whether the test binary was built with -race.
const raceDetector = false
