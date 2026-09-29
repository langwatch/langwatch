# visualdiff boots two refs side by side. The last real run failed before it
# ever captured a screen: the runner boots each ref itself on fixed ports and
# a hand-rolled environment, so a base worktree with no .env crash-loops on
# missing variables, and both refs land on the developer's own Postgres,
# ClickHouse and Redis. haven already isolates one stack per slug - its own
# databases, its own Redis index, its own hostnames, injected into every
# process it starts - so each ref becomes a haven stack under a slug of its
# own instead of something visualdiff boots by hand.
#
# Bound by Go tests in tools/visualdiff (`go test ./...`), annotated `// @scenario`.

Feature: visualdiff boots its stacks through haven

  Background:
    Given haven is installed on the machine

  Rule: A stack is a haven stack with an explicit slug

    @unit
    Scenario: Each stack gets a run-scoped slug
      Given a run whose run directory names run "20260909t2230"
      When the base and candidate stacks are planned
      Then the base stack is the slug "visualdiff-20260909t2230-base"
      And the candidate stack is the slug "visualdiff-20260909t2230-candidate"
      And each is started with LANGWATCH_SLUG set to that slug in agent mode

    @unit
    Scenario: A slug never collides with a developer's stack
      Given a registered stack whose slug is "feat-strict-feature-layout-v0"
      When a stack slug is derived
      Then it starts with "visualdiff-" and can never equal a slug haven derived from a worktree

    @unit
    Scenario: Isolation comes from haven, not from AllocateRedisDBs
      When a run boots through haven
      Then visualdiff sets no DATABASE_URL, CLICKHOUSE_URL, REDIS_URL or REDIS_DB_INDEX of its own
      And the AllocateRedisDBs step never runs
      And no ephemeral port is allocated

  Rule: A run only ever stops what it started

    @unit
    Scenario: Teardown names its own two slugs
      Given both stacks are up
      When the run tears down
      Then it runs haven destroy for exactly the two visualdiff slugs
      And it removes exactly the two worktrees it added
      And no other stack is stopped, restarted or flushed

    @unit
    Scenario: A failed boot still tears down only its own slugs
      Given the candidate stack failed to become ready within the boot timeout
      When the run gives up
      Then the base stack's slug is destroyed too
      And the failure names the slug and the last lines of that stack's backend log

  Rule: Readiness and addresses come from haven, not from a fixed port scheme

    @unit
    Scenario: The instance URL is the stack's app address
      Given haven status reports the base stack
      When the stack is addressed
      Then its URL is the app hostname haven allocated for that stack
      And its API is served under /api on that same origin, so the browser and the seeder use one address

    @unit
    Scenario: Ready means haven reports the ui and backend lanes healthy
      When the run waits for a stack
      Then it polls haven status --json until both the ui lane and the backend lane are listening or the boot timeout passes

    @unit
    Scenario: A monolith base is ready when its app lane is healthy
      Given haven status reports a stack whose layout is monolith and whose one app lane is listening
      When the stack is addressed
      Then it is ready
      And its URL is the app hostname haven allocated for that stack

    @unit
    Scenario: A monolith base's failure tail reads the app lane
      Given the base stack is the monolith layout and never becomes ready
      When the run gives up
      Then the failure tail comes from haven logs app for that stack, not haven logs backend

  Rule: A fresh worktree is prepared before its stack boots

    # Run 20260910-013825 died in haven's own prepare phase on both refs: the
    # base on "Cannot find module '~/generated/prisma/client'", the candidate
    # on "Cannot find module '.../langwatch/dist/index.mjs'", both then
    # "migrations failed - nothing was dropped". A fresh `git worktree add`
    # carries none of a developer checkout's generated or built artefacts -
    # they are all gitignored - and haven's own automatic prep is
    # migrate-and-seed, not install-and-build.

    @unit
    Scenario: A fresh worktree is prepared before its stack boots
      Given a fresh worktree with none of a developer checkout's generated or built artefacts
      When the worktree is prepared, before haven up runs
      Then it installs with a frozen lockfile and CI unset
      And it runs the generated-files step
      And a modular checkout also builds the workspace packages the api and worker import a built dist from
      And the developer's own .env is copied into the worktree
      And every step's name and exit status are written to the run log, never a byte of .env's contents

    @unit
    Scenario: A monolith worktree runs only the Prisma client before haven
      Given a checkout on the monolith layout
      When the worktree is prepared
      Then it runs the install and "pnpm --dir platform/app exec prisma generate"
      And it does not run "pnpm run start:prepare:files", because haven's own dev:app runs it before the app starts

    # Run 20260928-235909: the base never left the "instrument your agents"
    # pane, because nothing ingested its seeded traces, and its signed-in
    # admin was refused every back-office page. haven's monolith lane runs
    # dev:app, which starts no workers, and main seeds admin@haven.localhost
    # where the overlay names only the current seeded admin as an operator.
    @unit
    Scenario: A monolith base runs its workers and names every seeded admin an operator
      Given a checkout on the monolith layout
      When the worktree is prepared
      Then the app's own .env asks for its workers in-process
      And it names both the current and the retired seeded admin in ADMIN_EMAILS
      And the developer's own lines survive
      And a modular worktree is left alone

    @unit
    Scenario: A tracked dotenv file is never overwritten
      Given the workspace root holds both an untracked .env and the tracked .env.example
      When the developer's own .env is copied into the worktree
      Then .env is copied into the worktree
      And .env.example is left alone

  Rule: A missing gateway credential does not stop the diff, and never hides

    # The gateway's three credentials are checked all-or-none and each must be
    # at least 32 characters. A developer's own .env commonly carries short
    # placeholders, and the api then refuses to boot - correctly - so a run that
    # only wanted to photograph screens dies with it. visualdiff substitutes,
    # but only into the copied .env of a throwaway worktree whose databases
    # haven creates, migrates and seeds from scratch: the developer's own .env
    # is never written and their own virtual keys are never touched, because
    # rotating LW_VIRTUAL_KEY_PEPPER would invalidate every key it protects.
    #
    # The announcement is the feature. A tool that manufactures a secret to boot
    # itself is how a real "this branch will not boot without gateway secrets"
    # regression becomes invisible - the exact class of bug visualdiff exists to
    # catch - so every substitution is named on the run log, once per stack.

    @unit
    Scenario: A placeholder gateway secret is substituted in the worktree's own .env
      Given a copied .env whose gateway trio carries short placeholders
      When the worktree is prepared
      Then each of the three carries a value long enough for the gateway's own check
      And unrelated variables survive untouched
      And the developer's own line is commented rather than deleted
      And the run log names every variable substituted, and why

    @unit
    Scenario: A real gateway secret is never replaced
      Given a .env whose gateway trio already passes the gateway's own check
      When the worktree is prepared
      Then nothing is substituted
      And the file is not rewritten at all

    @unit
    Scenario: Both stacks of a run substitute the same value
      Given two worktrees of the same run
      When each is prepared
      Then the substituted secret is identical on both
      And a substituted secret can never be the reason two screens differ

    @unit
    Scenario: A worktree with no .env is left alone
      Given a worktree the developer had no .env to copy into
      When the worktree is prepared
      Then nothing is substituted
      And visualdiff does not author a .env the developer does not have

  Rule: A monolith ref is not refused up front - haven's own answer decides

    @unit
    Scenario: visualdiff does not gate the haven path on layout
      Given a stack still on the monolith layout
      When the stack is brought up through haven
      Then visualdiff still runs haven up for it and waits on the same two lanes as a modular stack
      And whether it becomes ready is entirely haven's own answer, not a refusal visualdiff makes up front

  Rule: The port-based path remains for machines without haven

    @unit
    Scenario: haven is the default when present
      Given haven is on PATH
      When visualdiff run is invoked with no infra flags
      Then the stacks boot through haven

    @unit
    Scenario: -no-haven keeps the port-based path
      Given the -no-haven flag, or a machine with no haven on PATH
      When visualdiff run is invoked
      Then it boots exactly as before, on its own ports with AllocateRedisDBs

  Rule: A findings stream reports each comparison as it completes

    # A run's report.html/findings.json/findings.md are still written once,
    # after the whole capture finishes - but a person or an agent watching a
    # long run wants to know what broke minutes before that, not only at the
    # end. findings.jsonl is that feed: one line per screen, the instant its
    # comparison is decided, fsynced so a `tail -f` sees it immediately.

    @unit
    Scenario: Findings stream while the run is still going
      Given a run capturing routes and flows on both stacks
      When a screen's comparison is decided - a failed capture, a new console error, or a computed pixel diff
      Then one JSON line is appended to findings.jsonl straight away, with the route or flow, its kind, its guessed module, evidence image paths relative to the run root, a one-line message and an RFC 3339 capturedAt
      And the write is flushed before the run continues, so a reader tailing the file sees it without waiting for the run to finish
      And once the capture stream ends, a screen that only ever got a base capture is reported "missing-on-candidate", and a final line reports "run-complete" with the total and the count for each kind

    @unit
    Scenario: A triage loop recaptures only the routes it fixed
      Given a run was started with -keep, so its two haven stacks are still up
      When "visualdiff recapture -run RUNID -routes a,b,c" runs
      Then it reads that run's own persisted plan for the two stacks' URLs rather than re-deriving them
      And it captures only the named routes, against those same two stacks
      And it never checks out a worktree, never runs haven up, and never tears anything down
      And its findings are appended to the same run's findings.jsonl, after whatever the run itself already wrote

  Rule: The base is rendered once per commit and replayed after that

    # Booting main is most of a run's cost, and main does not change between
    # two runs a developer makes while fixing their branch. Its captures are
    # kept per base commit, edition, configuration, runner source and UTC day
    # (seeded dates render as text), so a matching run never boots the base.

    @unit
    Scenario: A run against a base it has already rendered never boots the base
      Given an earlier run rendered the base at the same commit, edition, configuration and day
      When visualdiff run runs again
      Then the base's captures are replayed from .visualdiff/baselines
      And the base is never checked out, prepared or started
      And a changed route list, viewport or runner source renders the base live and caches it anew

    @unit
    Scenario: A recapture replays only the routes it names from the baseline
      Given a baseline recorded for every route
      When the runner is asked for three routes
      Then it replays exactly those three from the baseline

  Rule: Every screen is compared in both editions

    # Both refs seed the same signed local-dev enterprise licence onto the
    # organization, and a null licence is the open-source plan on both, so
    # one pair of stacks serves both editions by flipping that column.

    @unit
    Scenario: Every screen is captured once per edition
      Given a haven run with -editions enterprise,free (the default is enterprise alone)
      When it captures
      Then it captures an enterprise pass on the seeded licence, then a free pass with the licence cleared on every live stack
      And each pass writes its own screenshots, report and edition-tagged findings lines

    @unit
    Scenario: The free edition is refused where the database is the developer's own
      Given a -no-haven run, whose stacks share the developer's own database
      When the free edition is asked for
      Then the run refuses before anything boots, naming -editions enterprise
      And -no-haven defaults to the enterprise edition alone

  Rule: A broken candidate costs seconds, not a whole run

    @unit
    Scenario: A candidate whose shell does not render stops the run within its first routes
      Given the candidate is captured before the base
      When each of its first three routes throws, raises a page error or renders blank
      Then the run stops with every one of those routes and its reason
      And -no-fail-fast carries on regardless

    @unit
    Scenario: Each screen is diffed the moment both sides of it exist
      Given one side of a screen has been captured or replayed
      When the other side of it is captured
      Then its pixel diff is computed and reported straight away, not at the end of the run

    @unit
    Scenario: A stack haven gave up on fails the run at once
      Given haven has written its own fatal line to a stack's log and does not report the stack live
      When the run waits for that stack
      Then it fails on that line straight away, with the log tail, instead of waiting out the boot timeout
