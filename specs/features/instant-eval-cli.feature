Feature: langwatch instant-eval, asking one question of a whole production history

  As an AI engineer or an agent at a terminal
  I want to ask a question of every trace, thread or model call I have
  So that I get the matches back in minutes without writing SQL first

  Issue: Instant Evals, PR 5. ADR-137 amendment.

  The shape:
  - `langwatch instant-eval run` takes either the shorthand (`--target`, `--filter`, `--ask`)
    or a statement (`--sql`, `--sql-file`), starts a run and prints it.
  - In table mode `run` prints the statement it started under a "Statement" heading, so a
    reader learns the LangWatchQL the shorthand wrote for them.
  - `--estimate` prices the run and exits. A plain `run` over a thousand rows prices itself
    first and prints the estimate line before it creates anything, when that estimate
    succeeds; when pricing fails the run still starts, with a note saying so, and the
    caller's `--limit` bounds what can be judged and so what can be spent.
  - `--wait` polls every three seconds and reports progress on one line.
  - Every subcommand honours the output contract: `-o table|json|agents|yaml`, `--jq`.

  Background:
    Given a logged-in CLI with a project key
    And the Instant Evals flag is on for that project

  # ---------------------------------------------------------------------------
  # run: the shorthand
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A question given as the positional argument starts a run
    When the user runs instant-eval run "the customer sounds annoyed" --target threads
    Then one run is created with a boolean question carrying those instructions
    And the run's id and status are printed

  @unit
  Scenario: The positional argument and --ask are the same thing
    When the user runs instant-eval run --ask "the customer sounds annoyed"
    Then one boolean question is created
    And giving both the positional argument and --ask is refused

  @unit
  Scenario: Repeating --ask asks several questions of the same text
    When the user runs instant-eval run --ask "the customer is annoyed" --ask "the agent apologised"
    Then two questions are created, named q1 and q2
    And both are carried by one statement

  @unit
  Scenario: --criteria spells out the boundary of a boolean question
    When the user runs instant-eval run --ask "annoyed" --criteria "sarcasm counts" --criteria "a calm complaint does not"
    Then the question carries both criteria in the order written

  @unit
  Scenario: --score asks for a rating instead of a yes or no
    When the user runs instant-eval run --ask "how satisfied" --score 1..5
    Then the question is a score question over that range

  @unit
  Scenario: A malformed --score range is refused before anything is sent
    When the user runs instant-eval run --ask "how satisfied" --score 5
    Then the command exits non-zero
    And the message says a range is written min..max

  @unit
  Scenario: --category asks which option fits
    When the user runs instant-eval run --ask "what is being asked for" --category "refund=wants money back" --category "bug=something is broken"
    Then the question is a category question carrying both options

  @unit
  Scenario: --questions-file reads a list of questions with their own ids
    Given a JSON file holding two questions with ids of their own
    When the user runs instant-eval run --questions-file questions.json --target traces
    Then the run asks both questions under the ids the file gave
    And a YAML file is read the same way

  @unit
  Scenario: A run with no question at all is refused
    When the user runs instant-eval run --target traces
    Then the command exits non-zero
    And the message names the ways to ask a question

  @unit
  Scenario: --target picks what a row is
    When the user runs instant-eval run "annoyed" --target llm-spans
    Then the target sent is llm_spans
    And traces is the target when none is named

  @unit
  Scenario: --last sets the window and --start with --end sets it exactly
    When the user runs instant-eval run "annoyed" --last 7d
    Then the window sent covers the last seven days
    And --start with --end sends those two instants instead
    And --last together with --start is refused

  @unit
  Scenario: --filter is passed through to the shorthand
    When the user runs instant-eval run "annoyed" --filter "service:checkout"
    Then the filter reaches the server unchanged
    And a filter the server refuses is reported with the field it named

  # ---------------------------------------------------------------------------
  # run: the statement
  # ---------------------------------------------------------------------------

  @unit
  Scenario: --sql starts a run from a statement
    When the user runs instant-eval run --sql "SELECT TraceId, eval(...) AS annoyed FROM traces ..."
    Then the statement is sent as written
    And no target is sent with it

  @unit
  Scenario: --sql-file reads the statement from a file
    Given a file holding a statement
    When the user runs instant-eval run --sql-file query.sql
    Then the file's contents are sent as the statement

  @unit
  Scenario: A statement and a shorthand flag together are refused by the command
    When the user runs instant-eval run --sql "SELECT ..." --target traces
    Then the command exits non-zero
    And the message says to pick the statement or the shorthand

  @unit
  Scenario: --param binds the statement's own parameters
    When the user runs instant-eval run --sql-file query.sql --param since=2026-09-01 --param floor=0.5
    Then both values are sent as parameters, read as the types they look like

  # ---------------------------------------------------------------------------
  # Estimate before spend
  # ---------------------------------------------------------------------------

  @unit
  Scenario: --estimate prices the run and creates nothing
    When the user runs instant-eval run "annoyed" --target threads --estimate
    Then the estimate endpoint is called and the create endpoint is not
    And the rows, tokens, cost and price are printed

  @unit
  Scenario: A run over a thousand rows prints the estimate before it creates
    Given an estimate of five thousand rows
    When the user runs instant-eval run "annoyed" --limit 10000
    Then the estimate line is printed first
    And then the run is created

  @unit
  Scenario: A small run is created without a separate estimate call
    Given an estimate of two hundred rows
    When the user runs instant-eval run "annoyed" --limit 200
    Then the create endpoint is called once and the estimate endpoint is not called

  @unit
  Scenario: A machine format keeps the estimate out of the document
    When the user runs instant-eval run "annoyed" --limit 10000 -o json
    Then the printed document is the run alone
    And the estimate line went to standard error

  @unit
  Scenario: estimate is also its own subcommand, with the same inputs as run
    When the user runs instant-eval estimate "annoyed" --target threads --last 30d
    Then the estimate endpoint is called with the same body a run would have sent

  @unit
  Scenario: estimate prints what is left of the free budget
    Given an estimate carrying sixty cents of free budget remaining
    When the user runs instant-eval estimate "annoyed" --target threads --last 30d
    Then the printed estimate says sixty cents of free budget is left

  @unit
  Scenario: estimate prints no free budget line for a paid organization
    Given an estimate carrying no free budget figure
    When the user runs instant-eval estimate "annoyed" --target threads --last 30d
    Then the printed estimate has no free budget line

  # ---------------------------------------------------------------------------
  # Waiting, reading, stopping
  # ---------------------------------------------------------------------------

  @unit
  Scenario: --wait follows the run and reports progress on one line
    Given a run that reports three thousand two hundred of ten thousand judged with four hundred and twelve matched
    When the user waits on it
    Then the progress line reads "Judging... 3,200/10,000 (412 matched)"

  @unit
  Scenario: --wait ends when the run ends and reports what it found
    Given a run that finishes with matches
    When the user waits on it
    Then the wait reports the matches and the run's cost
    And the exit code is zero

  @unit
  Scenario: A failed run makes --wait exit non-zero
    Given a run that fails
    When the user waits on it
    Then the exit code is non-zero
    And the failure code is reported

  @unit
  Scenario: run waits for the run and prints what it found
    Given a line asking a question of a target
    When the run finishes
    Then the command prints how many rows matched, how long it took and what it cost
    And it points at the command that reads the rest of the matches

  @unit
  Scenario: run reads back the first rows of a finished run
    Given a run that has finished
    When the command prints its answer
    Then it re-reads the first rows through the sample, judging nothing again

  @unit
  Scenario: --show changes how many rows the run prints
    Given a line carrying --show 5
    When the run finishes
    Then five rows are read back instead of the default twenty

  @unit
  Scenario: A machine format answers with one document carrying the run and its rows
    Given a line asking for a machine format
    When the run finishes
    Then the document holds the run and the judgements of the rows it printed

  @unit
  Scenario: --detach creates the run and returns its id
    Given a line carrying --detach
    When the run is created
    Then the command answers with the id and never follows the run

  @unit
  Scenario: A run that failed exits non-zero
    Given a run that ends in a state other than finished
    When the command prints its answer
    Then the exit code is non-zero

  @unit
  Scenario: A run reports its progress on one line while it judges
    Given a run part way through its rows
    When its progress is rendered
    Then one line carries the judged count, the matches, the tokens and the time

  @unit
  Scenario: A finished run headlines the matches, the time and the price
    Given a finished run whose questions all answer yes or no
    When its headline is rendered
    Then it counts the matches against the rows it read, with the time, the tokens and the price

  @unit
  Scenario: A run that did not finish reports only what it judged
    Given a run that failed before judging any row
    When its headline is rendered
    Then it counts the rows it judged, not the rows it had selected

  @unit
  Scenario: A run whose questions are not yes or no reports what it read
    Given a finished run asking for a score
    When its headline is rendered
    Then it counts no matches, because a score has no threshold to be past

  @unit
  Scenario: A run that is already over is not polled
    Given a run that is already finished when the command starts following it
    When it is followed
    Then it answers at once without reading the run again

  @unit
  Scenario: A blocking run gives up following after its ceiling
    Given a run that is still going after forty five minutes
    When it is followed
    Then the command gives up, hands back the run it last read and points at the status command

  @unit
  Scenario: A blocking run stops following after repeated read failures
    Given a run whose reads keep failing
    When it is followed
    Then the command stops after five tries and keeps the run it last had

  @unit
  Scenario: A --last window past any date is refused
    Given a line asking for a window written with more digits than a date can hold
    When the window is read
    Then it is refused by name rather than reaching the API as an unreadable instant

  @unit
  Scenario: A wait that gives up while the API is down still answers
    Given a run being waited on and an API that answers nothing
    When the wait gives up after repeated read failures
    Then it answers with the run the caller already had, rather than failing on one more read

  @unit
  Scenario: A wait that times out while the API is down still answers
    Given a run being waited on and an API that answers nothing
    When the wait runs out of time before any read succeeds
    Then it answers with the run the caller already had, rather than failing on one more read

  @unit
  Scenario: --wait gives up after the minutes it was given
    Given a run that never finishes
    When the user waits two minutes on it
    Then the wait stops after two minutes
    And the exit code is non-zero
    And the run's id is printed so it can be followed later

  @unit
  Scenario: status reads one run
    When the user runs instant-eval status <id>
    Then the run's status, progress, matches, cost and price are printed
    And --wait follows it from there

  @unit
  Scenario: list reads the project's runs, newest first
    When the user runs instant-eval list
    Then each row carries the id, the name, the status, the progress and the matches

  @unit
  Scenario: results reads one page of judgements
    When the user runs instant-eval results <id>
    Then a page of judgements is printed
    And the next cursor is printed when there is one

  @unit
  Scenario: results narrows by question, by match and by state
    When the user runs instant-eval results <id> --question q1 --matched --status judged
    Then those three filters are sent
    And --status takes judged, skipped or failed

  @unit
  Scenario: sample reads a few rows with the text that was judged
    When the user runs instant-eval sample <id> -n 5
    Then five rows are asked for
    And each row is printed with the verdict it received

  @unit
  Scenario: cancel asks a run to stop
    When the user runs instant-eval cancel <id>
    Then the run is asked to stop
    And a run that already finished is reported as such

  # ---------------------------------------------------------------------------
  # The output contract
  # ---------------------------------------------------------------------------

  @unit
  Scenario: run prints the statement under a heading in table mode
    When the user runs instant-eval run "annoyed" --target threads
    Then the statement is printed under a Statement heading
    And a machine format prints the statement as a field of the run instead

  @unit
  Scenario: A refusal from the platform exits non-zero
    Given the platform refuses a run because the row cap was exceeded
    When the user runs instant-eval run "annoyed" --limit 50000
    Then the exit code is non-zero
    And the refusal is reported with the words the platform sent

  @unit
  Scenario: A failed response with no body is reported as a failed request
    Given a proxy answers 502 with an empty body because the platform is restarting
    When the user runs instant-eval status, list or cancel
    Then the failure names the operation and the 502 status
    And no command reads a field of a response that never arrived
