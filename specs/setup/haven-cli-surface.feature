@unit
Feature: haven CLI surface
  The primary user is an agent; humans get the hub. The daily verbs sit at the
  top level, tools sit under nouns, every --json output is versioned, and exit
  codes say what went wrong. Old spellings fail with the exact new one.
  See ADR-064 and its amendment of 2026-10-10.

  Scenario: A retired spelling exits 64 with the exact new spelling
    When the developer runs any retired spelling, such as "haven ps"
    Then it exits 64 without doing anything
    And the one line names the exact new spelling, "now: haven hub"
    And a spelling removed with no successor says so in one line
    And no retired spelling is also a live command

  Scenario: The retired stack-mode spellings point at the one switch
    When the developer runs "haven up --ui=watch", "haven up --ui bundled", "haven up --watch=false", "haven up --watch=true" or "haven up -w=false"
    Then it exits 64 with "now: haven up [--watch|--hmr]"
    And "haven up --watch --hmr" exits 64

  Scenario: A flag shorthand means one thing across the whole CLI
    Then "-f" is accepted only where it means "--follow"
    And "--force" forces the lifecycle on up and down only, in its long form
    And non-interactive confirmation of a destructive DATA action is always "--yes", never "--force"

  Scenario: An unknown command fails with a pointer, not a guess
    When the developer runs "haven upp"
    Then it exits 64 listing the closest valid commands
    And nothing is started or changed

  @integration @unimplemented
  Scenario: Down never touches data
    Given a running stack
    When the developer runs "haven down"
    Then the stack stops and its databases still exist
    And "haven down --force" kills hard instead of waiting on graceful shutdown
    And no flag on down can drop data

  @integration @unimplemented
  Scenario: Down --all returns the machine
    Given stacks running in several worktrees
    When the developer runs "haven down --all"
    Then every stack, the shared servers, the observability stack, the daemon, and the proxy are stopped
    And no data is dropped

  Scenario: Fresh data is an explicit, confirmed noun
    When the developer runs "haven db reset"
    Then it states which databases will be dropped and recreated and asks for confirmation
    And "--yes" replaces the prompt for scripts and agents
    And a preset name after "reset" seeds that preset, as in "haven db reset demo"

  # A registered stack's recorded database endpoints can be stale (a native
  # server since swapped for the container); the reset's children must not
  # follow them. Bound by tools/thuishaven app/db_test.go.
  Scenario: A reset migrates and seeds exactly the databases it dropped
    Given the worktree's stack is registered or not
    When the developer runs "haven db reset"
    Then the migrations and the seed run against the ClickHouse and Postgres databases it just dropped
    And they carry the same app origin "haven up" would give, so sign-in configuration loads

  # The shared database is what every worktree that never asked for its own
  # falls back to, so resetting it from the primary checkout takes data the
  # developer has no reason to think of as "this stack's". Bound by cmd/db_test.go.
  Scenario: Resetting the shared database asks for more than a keystroke
    Given the worktree's stack resolves to the shared main database
    When the developer runs "haven db reset"
    Then the prompt says the database is shared by every worktree without its own
    And only typing the database name continues — "y" does not
    And in agent mode it refuses, naming what the database is, until "--yes" is passed
    And "--yes" says which database it is about to drop before dropping it
    And a worktree's own database still takes a plain yes or no

  Scenario: Connection strings come from one place
    When the developer runs "haven db url postgres"
    Then this stack's Postgres connection string is printed
    And "clickhouse" and "redis" work the same way

  @integration @unimplemented
  Scenario: Cleanup is one interactive command
    When the developer runs "haven machine clean"
    Then the interactive picker offers every worktree with its databases, disk size, and idle time
    And the safe categories — build artifacts and orphaned dev processes — are reclaimed in the same run
    And in agent mode it prints the report and deletes nothing
    And "haven machine clean --yes" applies only the safe categories, never worktree deletion

  # Bound by cmd/browser_record_test.go; the daemon half is browser-record.test.ts.
  Scenario: A browser lane's actions are recorded as a script and replayed
    Given a lane is recording with "haven browser record start --lane qa-1"
    When the lane fills a field, picks an option and clicks a button
    And "haven browser record stop --lane qa-1 --out flow.json" runs
    Then the script holds each action with a role, label or text locator, never a snapshot ref
    And each step holds the page path after it and the app queries it caused, without bodies
    And a password field's value is stored as "<redacted>"
    And "haven browser replay flow.json --lane qa-1" exits non-zero at the first step whose path or queries differ

  # Bound by cmd/browser_record_test.go.
  Scenario: A recorded script exports as a Playwright test in the repo's e2e style
    Given a recorded script
    When the agent runs "haven browser record export flow.json --playwright flow.spec.ts"
    Then the spec imports "expect" and "test" from "../test.ts" and asserts each step's path

  Rule: Agent mode is automatic

    @unit @unimplemented
    Scenario: No terminal means agent mode
      Given stdout is not a TTY
      When the agent runs "haven up"
      Then haven asks no questions and prints no colour
      And the stack starts detached

    @unit
    Scenario Outline: An agent environment variable means agent mode inside a terminal
      Given a TTY
      And the environment sets "<variable>"
      When "haven up" runs
      Then haven asks no questions, prints no colour and detaches

      Examples:
        | variable       |
        | CLAUDECODE     |
        | CODEX_HOME     |
        | CODEX_SANDBOX  |

    @unit @unimplemented
    Scenario: --agent forces agent mode in a terminal
      Given a TTY and no agent environment variable
      When the developer runs "haven up --agent"
      Then haven behaves as in agent mode

    @integration @unimplemented
    Scenario: A long command in agent mode prints a bounded summary and the full log path
      Given agent mode
      When the agent runs "haven machine typecheck"
      Then the output is a bounded summary
      And it ends with the path of a file holding the full log

  Rule: Bare haven explains; the hub is a command

    @unit @unimplemented
    Scenario: Bare haven prints a status summary and grouped help
      When the developer runs "haven" in a terminal
      Then it prints this stack's status summary and the help grouped as daily, groups
      And nothing interactive opens

    @integration @unimplemented
    Scenario: haven hub opens the interactive hub
      Given a TTY
      When the developer runs "haven hub"
      Then the interactive hub shows every stack with health, RAM and actions

    @unit
    Scenario: The daily verbs are top level and the tools are grouped
      When the agent runs "haven help"
      Then the daily section lists up, down, restart, reload, status, logs, errors, env, browser, pr, switch, wait and defaults
      And the groups section lists sim, obs, orb, db, api, machine, self and hub

    @unit
    Scenario Outline: Hidden internals dispatch but stay out of help
      When the agent runs "haven help"
      Then "<command>" does not appear
      And "haven <command>" still dispatches

      Examples:
        | command   |
        | simulator |
        | static    |
        | go-watch  |
        | ui-watch  |
        | keep      |
        | daemon    |
        | gate      |

  Rule: Service choices are per stack, with a machine default

    @integration @unimplemented
    Scenario: up adds and removes services for this stack only, and they stick
      Given two worktrees with stacks
      When the developer runs "haven up +llm -langy" in the first
      Then the first stack runs llm and not langy, now and on every later "haven up"
      And the second stack's services are unchanged

    @unit
    Scenario: defaults edits the machine-wide default set
      When the developer runs "haven defaults +llm -langy"
      And then runs "haven defaults"
      Then the listed default set includes llm and not langy

    @integration @unimplemented
    Scenario: status shows where each service choice comes from
      Given the machine defaults include llm
      And this stack chose "+langy"
      When the agent runs "haven status --json"
      Then llm is reported as coming from the defaults
      And langy is reported as coming from this stack

    @unit @unimplemented
    Scenario: An unknown service is a usage error
      When the agent runs "haven up +nonsense"
      Then it exits 64 listing the valid service names
      And nothing starts

  Rule: Destroying a stack is down --destroy, confirmed by the slug

    @unit
    Scenario: In a terminal only the typed slug destroys
      Given a TTY and a stack "feat-x"
      When the developer runs "haven down --destroy --stack feat-x" and answers "y"
      Then nothing is dropped
      And typing "feat-x" stops the stack and drops its databases

    @unit
    Scenario: An agent without --yes is refused
      Given agent mode and a stack "feat-x"
      When the agent runs "haven down --destroy --stack feat-x"
      Then it exits 64 naming "--yes"
      And the stack and its databases are untouched

    @integration @unimplemented
    Scenario: An agent with --yes destroys and names what it dropped
      Given agent mode and a stack "feat-x"
      When the agent runs "haven down --destroy --stack feat-x --yes"
      Then the stack stops, its databases are dropped, and the output names "feat-x"

    @integration @unimplemented
    Scenario: Plain down keeps data
      Given a running stack
      When the developer runs "haven down"
      Then the stack stops and its databases still exist

  Rule: pr absorbs play

    @integration @unimplemented
    Scenario: pr makes a lasting worktree and stack
      When the developer runs "haven pr 4913"
      Then a worktree and a stack exist for PR 4913
      And they outlive the command

    @integration @unimplemented
    Scenario: pr --throwaway deletes everything it created on quit
      When the developer runs "haven pr 4913 --throwaway" and quits
      Then its checkout, databases, volumes, hostnames and record are gone
      And the trust gate of haven-play.feature ran before the checkout

  Rule: switch is top level; its shell function comes from self setup

    @integration @unimplemented
    Scenario: With the shell function, switch changes directory
      Given the shell line from "haven self setup" is in ~/.zshrc
      When the developer runs "haven switch feat-x"
      Then the shell's directory is the feat-x worktree

    @unit @unimplemented
    Scenario: Without the shell function, switch prints the path and a hint
      Given no haven shell function is loaded
      When the developer runs "haven switch feat-x"
      Then it prints the feat-x worktree's path
      And a one-line hint names "haven self setup"

    @unit @unimplemented
    Scenario: self setup asks before touching ~/.zshrc
      When the developer runs "haven self setup" and declines the shell line
      Then ~/.zshrc is unchanged
      And accepting adds exactly one line

  Rule: Every simulator is a sim with one core vocabulary

    @unit
    Scenario: Bare sim lists every simulator
      Given this stack runs mail but not llm
      When the agent runs "haven sim --json"
      Then there is one row each for mail, llm, payment, storage, idp, outbound, analytics, lambda, voice and telemetry
      And mail is running with its console URL
      And llm is not running and names "haven up +llm"

    @unit
    Scenario Outline: A simulator's old verb names its core verb
      When the agent runs "<old>"
      Then it exits 64 with "now: <new>"
      And nothing is changed

      Examples:
        | old                           | new                              |
        | haven mail inbox              | haven sim mail status            |
        | haven mail set --error 503    | haven sim mail fault 503         |
        | haven llm calls               | haven sim llm list               |
        | haven llm call abc            | haven sim llm get abc            |
        | haven lambda info             | haven sim lambda status          |
        | haven analytics records       | haven sim analytics list         |
        | haven outbound records        | haven sim outbound list          |
        | haven payment events          | haven sim payment list           |
        | haven payment reset           | haven sim payment clear          |
        | haven payment fail            | haven sim payment fault          |
        | haven payment clear-failures  | haven sim payment fault off      |
        | haven storage requests        | haven sim storage list           |
        | haven voice calls             | haven sim voice list             |
        | haven idp tenants             | haven sim idp list               |
        | haven idp tenant show acme    | haven sim idp get acme           |
        | haven idp reset acme          | haven sim idp clear acme         |
        | haven telemetry runs          | haven sim telemetry list         |
        | haven telemetry run abc       | haven sim telemetry get abc      |
        | haven sims                    | haven sim                        |

    @unit
    Scenario: A simulator's own verbs stay on it
      When the agent runs "haven help sim payment"
      Then advance, complete, deliver, hold and release are listed beside the core verbs

    @integration @unimplemented
    Scenario: fault injects an error and fault off removes it
      Given mail is running
      When the agent runs "haven sim mail fault 503"
      Then the next send through mail gets a 503
      And after "haven sim mail fault off" sends succeed again

    @integration @unimplemented
    Scenario: A simulator that is not running is exit 65
      Given this stack does not run llm
      When the agent runs "haven sim llm list"
      Then it exits 65 naming "haven up +llm"

    @integration @unimplemented
    Scenario: A simulator wait that never matches is exit 66
      Given mail is running and catches nothing
      When the agent runs "haven sim mail wait --timeout 2s"
      Then it exits 66 after about two seconds

  Rule: Observability tools sit under obs; logs and errors stay top level

    @unit
    Scenario Outline: The old observability commands point under obs
      When the agent runs "<old>"
      Then it exits 64 with "now: <new>"

      Examples:
        | old                         | new                             |
        | haven traces                | haven obs traces                |
        | haven metrics               | haven obs metrics               |
        | haven profiles              | haven obs profiles              |
        | haven query logql '{a="b"}' | haven obs query logql '{a="b"}' |

    @unit
    Scenario: logs follows with -f and -t is retired
      Given a running stack
      When the agent runs "haven logs nlp -f --json"
      Then each line is one JSON event with a "type" field
      And "haven logs -t" exits 64 with "now: haven logs -f"

  Rule: The orb is a group, and it reaches built pages

    @unit
    Scenario Outline: feedback and page move under orb
      When the agent runs "<old>"
      Then it exits 64 with "now: <new>"

      Examples:
        | old                 | new                     |
        | haven feedback list | haven orb feedback list |
        | haven page console  | haven orb console       |
        | haven page network  | haven orb network       |

    @integration @unimplemented
    Scenario: The orb is injected into a haven stack's built UI
      Given a haven stack serving the built UI
      When a page of the app loads
      Then the haven orb is on the page
      And "haven orb console" reports that page's console messages

    @unit @unimplemented
    Scenario: A production build never carries the orb
      When apps/ui is built for production
      Then no orb code or injection point is in the output

  Rule: Data lives under db

    @integration @unimplemented
    Scenario: db logins prints the seeded logins with credentials masked
      Given a seeded stack
      When the agent runs "haven db logins"
      Then every seeded login is listed with its credentials masked
      And "--reveal" prints them

    @unit
    Scenario: haven seed folds into db seed
      When the agent runs "haven seed --size small"
      Then it exits 64 with "now: haven db seed --size small"

  Rule: The browser absorbs auth and mfa

    @integration @unimplemented
    Scenario: browser login writes a Playwright storage state without printing a password
      Given a running stack
      When the agent runs "haven browser login --as admin"
      Then a Playwright storage-state file for admin is written
      And no password appears in the output

    @unit
    Scenario Outline: auth and mfa point under browser
      When the agent runs "<old>"
      Then it exits 64 with "now: <new>"

      Examples:
        | old                   | new                                 |
        | haven auth admin      | haven browser login --as admin      |
        | haven mfa list        | haven browser mfa list              |
        | haven mfa totp fill   | haven browser mfa totp fill         |

  Rule: Machine and self tools are grouped

    @unit
    Scenario Outline: Machine and self commands point at their group
      When the agent runs "<old>"
      Then it exits 64 with "now: <new>"
      And nothing runs

      Examples:
        | old                         | new                                 |
        | haven limits                | haven machine limits                |
        | haven run --sh "pnpm test"  | haven machine run --sh "pnpm test"  |
        | haven slot explain          | haven machine slot explain          |
        | haven typecheck --affected  | haven machine typecheck --affected  |
        | haven clean                 | haven machine clean                 |
        | haven install               | haven self install                  |
        | haven setup                 | haven self setup                    |
        | haven upgrade               | haven self upgrade                  |
        | haven shell-init            | haven self shell-init               |
        | haven destroy feat-x        | haven down --destroy --stack feat-x |
        | haven play 4913             | haven pr 4913 --throwaway           |

  Rule: Deleted commands say so and name what replaced them, if anything

    @unit
    Scenario Outline: A deleted command exits 64 with one line
      When the agent runs "<old>"
      Then it exits 64 with "<message>"

      Examples:
        | old          | message                        |
        | haven hmr    | removed, no replacement        |
        | haven git    | removed, no replacement        |
        | haven jobs   | now: haven status              |
        | haven stores | now: haven status              |

    @integration @unimplemented
    Scenario: status carries the jobs and stores sections
      Given a running stack
      When the agent runs "haven status --json jobs,stores"
      Then the object has "v" 1, the resolved stack, and the jobs and stores fields

  Rule: The target stack is explicit, then per shell, then the working directory

    @unit @unimplemented
    Scenario: --stack wins over HAVEN_STACK and the working directory
      Given HAVEN_STACK is "feat-b" and the working directory is in worktree "feat-c"
      When the agent runs "haven status --stack feat-a --json"
      Then the reported stack is "feat-a"

    @unit @unimplemented
    Scenario: HAVEN_STACK wins over the working directory
      Given HAVEN_STACK is "feat-b" and the working directory is in worktree "feat-c"
      When the agent runs "haven status --json"
      Then the reported stack is "feat-b"

    @unit @unimplemented
    Scenario: The working directory's worktree is the fallback
      Given HAVEN_STACK is unset and the working directory is in worktree "feat-c"
      When the agent runs "haven status --json"
      Then the reported stack is "feat-c"

    @integration @unimplemented
    Scenario: Outside a worktree a terminal gets a picker
      Given a TTY outside any worktree and HAVEN_STACK unset
      When the developer runs "haven logs"
      Then a picker of the known stacks opens

    @unit
    Scenario: Outside a worktree an agent gets the list of slugs
      Given agent mode outside any worktree and HAVEN_STACK unset
      When the agent runs "haven logs"
      Then it exits 64 listing every known slug

    @unit
    Scenario: An unknown slug is a usage error
      When the agent runs "haven status --stack nope"
      Then it exits 64 listing every known slug

    @unit @unimplemented
    Scenario: There is no machine-global current stack
      Given one shell sets HAVEN_STACK to "feat-a"
      When another shell in worktree "feat-c" runs "haven status --json"
      Then the reported stack is "feat-c"

  Rule: Structured output is versioned, selectable and typed

    @unit
    Scenario: Every --json output is versioned
      When the agent runs any command with "--json"
      Then the output is one object whose "v" is 1
      And it validates against the command's published schema

    @unit
    Scenario: --json with fields selects them
      When the agent runs "haven status --json stack,services"
      Then the object holds "v", "stack" and "services" and nothing else

    @unit
    Scenario: Bare --json on a command with fields lists them
      When the agent runs "haven status --json"
      Then the available fields are listed

    @unit
    Scenario: An unknown field is a usage error
      When the agent runs "haven status --json nonsense"
      Then it exits 64 naming the valid fields

    @integration @unimplemented
    Scenario: Streams are NDJSON with a type on every line
      Given a stack that is starting
      When the agent follows "haven logs -f --json"
      Then every line is one JSON object with a "type" discriminator

  Rule: wait blocks on a stack state, bounded

    @integration @unimplemented
    Scenario: wait --for ready returns once the stack is ready
      Given a stack that is starting
      When the agent runs "haven wait --for ready"
      Then it exits 0 once every selected service answers

    @integration @unimplemented
    Scenario: wait --for stopped returns once the stack has stopped
      Given a stack that is stopping
      When the agent runs "haven wait --for stopped"
      Then it exits 0 once no process of the stack remains

    @integration @unimplemented
    Scenario: wait that runs out of time is exit 66
      Given a stack that never becomes ready
      When the agent runs "haven wait --for ready --timeout 5s"
      Then it exits 66 after about five seconds

    @unit
    Scenario: wait without --for is a usage error
      When the agent runs "haven wait"
      Then it exits 64 naming "--for ready|stopped"

  Rule: Exit codes say what went wrong

    @integration @unimplemented
    Scenario: A command that needs a running stack is exit 65 when it is down
      Given this stack is stopped
      When the agent runs "haven api GET /api/health"
      Then it exits 65

    @integration @unimplemented
    Scenario: A refusal by the machine gate is exit 67
      Given the machine gate refuses another heavy run
      When the agent runs "haven machine typecheck"
      Then it exits 67

    Scenario: A wrapped command's exit code passes through
      Given a command haven wraps exits 7
      Then haven exits 7, untouched

  Rule: Old spellings fail with the exact new one

    @unit
    Scenario Outline: A spelling retired by v2 points at the new surface
      When the agent runs "<old>"
      Then it exits 64 with "now: <new>"
      And nothing is started or changed

      Examples:
        | old          | new                           |
        | haven ps     | haven hub                     |
        | haven watch  | haven hub                     |
        | haven ls     | haven status                  |
        | haven tc     | haven machine typecheck       |
        | haven oc     | haven machine clean           |
        | haven doctor | haven self doctor             |
        | haven ch     | haven db url clickhouse       |
        | haven cd     | haven switch                  |

    @unit
    Scenario: The pointer carries the caller's arguments over
      When the agent runs "haven mail list --to a@b.test --json"
      Then it exits 64 with "now: haven sim mail list --to a@b.test --json"
