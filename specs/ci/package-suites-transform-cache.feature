Feature: The package-suites shards keep vitest's transformed modules between runs
  As a developer waiting on the package-suites shards
  I want a suite not to transform the same unchanged source on every run
  So that the shards spend their time running tests

  # Vitest spent about a tenth of a shard's suite time transforming modules,
  # on every run, because a fresh runner starts with an empty
  # node_modules/.vitest-cache. Vitest itself said so in the job log: "persist
  # transforms across runs with fsModuleCache: true; on CI this only helps when
  # the cache directory is persisted between runs". The job now restores that
  # directory per shard and saves it at the end.
  #
  # A cached transform must never make a test pass that would fail. Vitest keys
  # each entry by the module's own source, the vitest config files and plugin
  # names, and clears the cache when the lockfile changes. It does not key how
  # an import resolves (the package manifests) or what a tsconfig tells the
  # transform, and the shared config in packages/vitest-config is imported as a
  # package, so its source (the plugins and their options) is not a config file
  # to vitest either. The job restores only a cache built from the same lockfile,
  # package.json files, tsconfig files and shared config, and never a nearer one.
  #
  # ciguard asserts all of it (go run ./cmd/ciguard).

  Rule: a restored transform is never stale

    @unit
    Scenario: The transform cache is restored only for the same inputs
      Given the package-suites job's vitest transform cache
      When its key and restore keys are read
      Then the key names a hash of the lockfile, every package.json, every tsconfig and the shared vitest config
      And it restores only a cache saved under that same hash

    @unit
    Scenario: Each shard keeps its own transform cache, saved under its commit
      Given the package-suites job's vitest transform cache
      When its key is read
      Then the key names the shard and ends in the commit

  Rule: the saved cache stays small

    # A restored file keeps the time it was first written and nothing records a
    # read, so purging entries by age drops the ones every run uses first. A new
    # lockfile, manifest, tsconfig or shared config already starts a fresh cache.
    @unit
    Scenario: A transform cache past its size limit is dropped whole before the save
      Given the package-suites job
      When its steps are read
      Then one empties the transform cache whole when it is past its size limit
      And the emptied directory is left in place, so the save replaces the oversized cache
      And none purges single transforms by age

  Rule: every suite persists its transforms

    @unit
    Scenario: A suite that runs vitest without a config file asks for the transform cache
      Given a package whose suite script runs vitest with no vitest config file
      When its scripts are read
      Then the script passes --fsModuleCache

    @unit
    Scenario: A suite whose own vitest config does not persist transforms asks for the cache
      Given a package whose vitest config neither sets fsModuleCache nor builds on the shared config
      When its scripts are read
      Then each suite script that runs vitest with that config is listed
