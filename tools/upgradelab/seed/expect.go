package seed

import (
	"errors"
	"fmt"
	"maps"
	"slices"
)

// RecipeVersion is the generator recipe this upgradelab writes and reads; a manifest's recipe.version.
const RecipeVersion = 1

// CheckRecipe refuses a recipe version this upgradelab does not know, naming it and the known one.
func CheckRecipe(version int) error {
	if version != RecipeVersion {
		return fmt.Errorf("recipe version %d is unknown: this upgradelab knows recipe version %d", version, RecipeVersion)
	}
	return nil
}

// Expect is what a generated snapshot must hold: the least count per product kind.
type Expect map[string]int

// ExpectedKinds is one of each seedable product kind.
func ExpectedKinds() Expect {
	expect := Expect{}
	for _, kind := range seedableKinds() {
		expect[kind.Kind] = 1
	}
	return expect
}

// Check names every kind whose count falls short, with the count found and the count wanted.
func (expect Expect) Check(counts map[string]int) error {
	var misses []error
	for _, kind := range slices.Sorted(maps.Keys(expect)) {
		if counts[kind] < expect[kind] {
			misses = append(misses, fmt.Errorf("the snapshot holds %d %s, want at least %d", counts[kind], kind, expect[kind]))
		}
	}
	return errors.Join(misses...)
}
