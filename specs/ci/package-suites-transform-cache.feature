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
  # transform, so the job restores only a cache built from the same lockfile,
  # package.json files and tsconfig files, and never a nearer one.
  #
  # ciguard asserts all of it (go run ./cmd/ciguard).

  Rule: a restored transform is never stale

    @unit
    Scenario: The transform cache is restored only for the same inputs
      Given the package-suites job's vitest transform cache
      When its key and restore keys are read
      Then the key names a hash of the lockfile, every package.json and every tsconfig
      And it restores only a cache saved under that same hash

    @unit
    Scenario: Each shard keeps its own transform cache, saved under its commit
      Given the package-suites job's vitest transform cache
      When its key is read
      Then the key names the shard and ends in the commit

  Rule: the saved cache stays small

    @unit
    Scenario: Transforms no run has written for a week are dropped before the save
      Given the package-suites job
      When its steps are read
      Then one deletes week-old files from the transform cache

  Rule: every suite persists its transforms

    @unit
    Scenario: A suite that runs vitest without a config file asks for the transform cache
      Given a package whose suite script runs vitest with no vitest config file
      When its scripts are read
      Then the script passes --fsModuleCache
