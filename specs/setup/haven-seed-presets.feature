Feature: Seed presets — a database that is ready to look at
  A freshly seeded project greets you with the onboarding "waiting for your
  first message" screen, which is the wrong starting point when you are working
  on everything after onboarding. `haven db seed [preset]` reseeds in place
  (an idempotent upsert, nothing dropped); `haven db reset [preset]` is the
  destructive sibling that starts from a fresh database. Presets are
  positional and shared by both: demo, onboarding, post-onboarding, bare
  (ADR-064). One registry serves the whole CLI — `haven play --seed <preset>`
  seeds a throwaway PR sandbox from the same list (haven-play.feature).

  # Every preset is env switches that packages/prisma-client/prisma/seed.ts
  # reads for itself, so no preset needs a running stack. The `traces` and
  # `mass` presets are RETIRED: their entire content was ingest steps
  # (seed:retention, seed:sample-traces, seed:realistic-platform, seed:mass)
  # that lived in the deleted platform application, and nothing that survives
  # loads data through the collector. The ingest seam itself is intact and
  # covered — a preset that carries steps still refuses a stack that is not up,
  # still targets the app's own loopback port, and still gives up rather than
  # ingesting into nothing.
  #
  # Behavior lives in tools/thuishaven `app/db.go` (the seedPresets registry,
  # retiredSeedPresets, DBSeed, DBReset, the live-stack ingest steps) plus
  # packages/prisma-client/prisma/seed.ts. Bound by Go tests (`go test ./...`
  # in tools/thuishaven): `app/db_test.go` (TestDBSeed, TestDBReset). The full
  # ingest-through-the-collector path is only exercised manually, so those
  # scenarios stay `@unimplemented`. The parity checker
  # (`packages/architecture-lint/src/check-feature-parity.ts`) scans tools/thuishaven's Go
  # tests: @unit scenarios are bound by `// @scenario` annotations above those
  # test funcs.

  @unit
  Scenario: The default seed is unchanged
    When I run "haven db seed"
    Then the stable local identity (user, organization, project, API key) is seeded
    And no preset content is added

  @unit
  Scenario: Reseeding drops nothing
    Given this worktree's databases hold data
    When I run "haven db seed" with any preset
    Then no database is dropped and no confirmation is asked
    And "haven db reset" is the only path to a fresh database

  @unit
  Scenario: Unknown presets are rejected with the available choices
    When I run "haven db seed nosuch"
    Then the command fails before touching anything
    And the error lists the presets I can pick from

  @unit
  Scenario: Retired presets say so rather than reading as a typo
    When I run "haven db seed" with a preset whose data was deleted
    Then the command fails saying that preset is retired, not that it is unknown
    And it lists the presets that are left
    And nothing is seeded

  @unit
  Scenario: A preset that ingests needs the stack up
    Given a preset that loads data through the running stack's collector
    And this worktree's stack is not running
    When I seed with it
    Then the identity is seeded first
    And the command fails naming the command that retries the data load

  # The demo content includes a prompt and an HTTP agent pointed at a public
  # echo service (httpbin.org), so prompt management and HTTP-agent scenario
  # targets both have something real to open — the agent completes a live
  # round-trip with no API key. Both are seeded as raw JSON that the app
  # re-validates on every read; the binding test runs those exact validators.
  @unit
  Scenario: The demo preset ships a working prompt and HTTP agent
    Given the demo preset has been seeded
    When the prompt and the HTTP agent are opened
    Then both load the way the product reads them, ready to use

  # Cheap variants composed from switches the seed already understands:
  #   onboarding      — first-trace flag cleared: land on the onboarding journey
  #   post-onboarding — past onboarding without demo content
  #   bare            — identity only: no env-derived providers, stock flags

  # The seed-script scenario below runs prisma/seed.ts against a real
  # database; no automated harness drives that today, so it stays
  # @unimplemented (the Go tests only cover the env plumbing).
  @integration @unimplemented
  Scenario: Model providers are seeded from the environment by default
    Given a provider API key is set in the environment or a dotenv layer
    When I run "haven db seed"
    Then that provider is seeded as an enabled org-scoped credential
    And re-running updates the same credential instead of duplicating it
    And the bare preset seeds no providers
