package domain

import "testing"

// The collision that motivated AllocateRedisDB: three concurrently-live
// worktrees whose slugs all hash to the same database. Redis carries the
// GroupQueue, so sharing one means sharing a job queue while writing to
// separate ClickHouse databases — work lands in the wrong stack silently.
func TestRedisDBForSlugCollidesInPractice(t *testing.T) {
	slugs := []string{
		"scenario-child-startup",
		"shared-ops-snapshot-plan",
		"bugbash-integration",
	}
	first := RedisDBForSlug(slugs[0])
	for _, slug := range slugs[1:] {
		if got := RedisDBForSlug(slug); got != first {
			t.Fatalf("expected the observed collision on db %d, %q got %d", first, slug, got)
		}
	}
}

func TestAllocateRedisDBPrefersTheHashWhenFree(t *testing.T) {
	slug := "scenario-child-startup"
	db, exclusive := AllocateRedisDB(slug, map[int]bool{})
	if !exclusive {
		t.Fatal("expected an exclusive database when none are taken")
	}
	if db != RedisDBForSlug(slug) {
		t.Fatalf("want the preferred db %d, got %d", RedisDBForSlug(slug), db)
	}
}

func TestAllocateRedisDBProbesPastTakenDatabases(t *testing.T) {
	slugs := []string{
		"scenario-child-startup",
		"shared-ops-snapshot-plan",
		"bugbash-integration",
	}

	taken := map[int]bool{}
	seen := map[int]string{}
	for _, slug := range slugs {
		db, exclusive := AllocateRedisDB(slug, taken)
		if !exclusive {
			t.Fatalf("%q: expected an exclusive database, 16 were free", slug)
		}
		if other, clash := seen[db]; clash {
			t.Fatalf("%q got db %d, already held by %q", slug, db, other)
		}
		// Uniqueness alone would also pass for an allocator that picked any
		// free database. The contract is narrower: probe upward from the
		// slug's own preferred index, so a stack's database stays a function
		// of its slug plus whoever got there first.
		if want := nextFreeFrom(RedisDBForSlug(slug), taken); db != want {
			t.Fatalf("%q: want the next free db %d from preferred %d, got %d",
				slug, want, RedisDBForSlug(slug), db)
		}
		seen[db] = slug
		taken[db] = true
	}
}

// nextFreeFrom mirrors the documented probe order independently of the
// implementation: the first unheld database at or after `preferred`, wrapping.
func nextFreeFrom(preferred int, taken map[int]bool) int {
	for offset := range RedisDBCount {
		candidate := (preferred + offset) % RedisDBCount
		if !taken[candidate] {
			return candidate
		}
	}
	return preferred
}

func TestAllocateRedisDBReportsWhenNoneAreFree(t *testing.T) {
	taken := map[int]bool{}
	for db := range RedisDBCount {
		taken[db] = true
	}

	db, exclusive := AllocateRedisDB("scenario-child-startup", taken)
	if exclusive {
		t.Fatal("expected exclusive=false when every database is held")
	}
	// Still returns a usable index rather than a sentinel: the caller warns
	// and carries on, it does not refuse to start. Which index matters — it
	// falls back to the slug's preferred one, so a stack forced to share keeps
	// the database it would have had, rather than landing somewhere arbitrary.
	if db < 0 || db >= RedisDBCount {
		t.Fatalf("db %d out of range", db)
	}
	if want := RedisDBForSlug("scenario-child-startup"); db != want {
		t.Fatalf("want the preferred db %d when all are held, got %d", want, db)
	}
}
