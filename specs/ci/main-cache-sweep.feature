Feature: Main keeps one copy of each per-commit cache
  As a developer waiting on CI
  I want the repository's Actions cache to stay under its storage limit
  So that jobs can keep saving caches and runs do not start cold

  # Several caches are keyed by the commit so they always save (nx-cache,
  # go-build-cache, the package suite results). A pull request prunes its older
  # copy after saving, but main never did: every push to main added a fresh
  # copy, up to ~700 MB each, until the repository reached its cache budget.
  # Once there, GitHub makes the cache read-only and every save fails. On
  # 2026-10-28 that left the package suites at 1 Nx cache hit in 125 suites.
  # Any of these caches restores from the newest copy through its restore-keys,
  # so only that copy is worth keeping.

  @unit
  Scenario: Older per-commit copies on main are superseded by the newest
    Given main holds three copies of a cache keyed by the commit
    When the sweep runs
    Then the two older copies are deleted
    And the newest copy stays

  # A pull request branched before a lockfile bump still restores from main's
  # copy under the old hash, and the package dist cache has no fallback wider
  # than the hash, so each hash keeps its newest copy until it expires.
  @unit
  Scenario: Each lockfile hash keeps its own newest copy
    Given main holds two copies of a cache under one lockfile hash
    And one copy under a newer lockfile hash
    When the sweep runs
    Then the older copy under the first hash is deleted
    And the newest copy under each hash stays

  @unit
  Scenario: Caches with different names before the commit are kept apart
    Given main holds one copy each of the shard 1 and shard 2 suite results
    When the sweep runs
    Then both copies stay

  @unit
  Scenario: Caches not keyed by a commit are left alone
    Given main holds Docker layer blobs and caches keyed only by a lockfile hash
    When the sweep runs
    Then none of them is deleted
