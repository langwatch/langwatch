Feature: Asking a wrapped tool for its help or version has no side effects

  `langwatch <tool>` sets a tool up before it launches it: it reads the login,
  may start a device login, mints an ingest key, and writes the tool's
  telemetry wiring (the claude settings env block, the codex `[otel]` block,
  the scoped shell functions). A run that only asks the tool for its help
  or its version starts no session, so there is nothing to capture and
  nothing to set up. It goes straight to the tool.

  This holds for every wrapper: claude, codex, copilot, gemini, opencode,
  cursor and code.

  Rule: a help or version run goes straight to the tool

    @unit
    Scenario Outline: The run is recognised by its flag
      When the user runs `langwatch codex <args>`
      Then the run is <kind>

      Examples:
        | args                     | kind                 |
        | --help                   | a help run           |
        | -h                       | a help run           |
        | exec --help              | a help run           |
        | --version                | a version run        |
        | exec "fix the build"     | a session to set up  |
        | exec -- --help           | a session to set up  |
        | exec "explain -h to me"  | a session to set up  |

    @unit
    Scenario Outline: A help run sets nothing up
      Given the device has no LangWatch login
      When the user runs `langwatch <tool> --help`
      Then the config file is not read and no login is started
      And no ingest key is minted
      And no telemetry wiring is written for the tool
      And the tool is launched with `--help` and the environment of the calling shell
      And the command exits with the tool's exit code

      Examples:
        | tool     |
        | claude   |
        | codex    |
        | copilot  |
        | gemini   |
        | opencode |

    @unit
    Scenario: The wrapper's own flags are not passed to the tool
      When the user runs `langwatch codex --project acme --tool-mode=gateway --help`
      Then codex is launched with `--help` alone

    @unit
    Scenario: What follows -- reaches the tool as typed
      # Everything from `--` on belongs to the tool, so a `--project` written
      # there is the tool's own flag.
      When the user runs `langwatch codex --project acme --help -- --project acme`
      Then codex is launched with `--help -- --project acme`

    @unit
    Scenario: A help run lists the wrapper's own flags after the tool's help
      When the user runs `langwatch codex --help`
      Then after codex's help the wrapper lists `--project`, `--personal` and `--tool-mode`
      And it says these are read by langwatch and not passed to codex

    @unit
    Scenario: A version run prints nothing of the wrapper's own
      When the user runs `langwatch codex --version`
      Then only codex's output is printed
