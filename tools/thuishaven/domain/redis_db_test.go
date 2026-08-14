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
		seen[db] = slug
		taken[db] = true
	}
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
	// and carries on, it does not refuse to start.
	if db < 0 || db >= RedisDBCount {
		t.Fatalf("db %d out of range", db)
	}
}
