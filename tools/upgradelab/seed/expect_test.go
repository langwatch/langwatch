package seed

import (
	"context"
	"strings"
	"testing"
)

// @scenario "an unknown recipe version is refused"
func TestCheckRecipeRefusesAnUnknownVersion(t *testing.T) {
	if err := CheckRecipe(RecipeVersion); err != nil {
		t.Fatalf("the known version is refused: %v", err)
	}
	err := CheckRecipe(2)
	if err == nil || !strings.Contains(err.Error(), "recipe version 2 is unknown") || !strings.Contains(err.Error(), "knows recipe version 1") {
		t.Fatalf("err %v, want version 2 and the known version 1 named", err)
	}
}

func seededThenCounted(t *testing.T, app *oldApp) map[string]int {
	t.Helper()
	seeder := seederFor(t, app)
	if err := seeder.Seed(context.Background()); err != nil {
		t.Fatal(err)
	}
	counts, err := seeder.Count(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return counts
}

// @scenario "a generated snapshot holds every expected product kind"
func TestExpectPassesWhenEveryKindIsListed(t *testing.T) {
	counts := seededThenCounted(t, newOldApp())
	if err := ExpectedKinds().Check(counts); err != nil {
		t.Fatalf("every kind listed, still: %v", err)
	}
	if len(counts) != 7 || counts["workflow"] != 1 {
		t.Errorf("counts %v, want 7 kinds and only the seed's own workflow", counts)
	}
}

// @scenario "an Expect miss names the kind and the count"
func TestExpectMissNamesTheKindAndTheCount(t *testing.T) {
	app := newOldApp()
	app.answers["suites.getAll"] = []any{}
	err := ExpectedKinds().Check(seededThenCounted(t, app))
	if err == nil || err.Error() != "the snapshot holds 0 suite, want at least 1" {
		t.Fatalf("err %v, want the suite miss named with its count", err)
	}
}
