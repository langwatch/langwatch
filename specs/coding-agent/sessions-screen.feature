# The Sessions screen, every coding-agent session I ran and what it cost me
#
# Implementation:
#   modules/coding-agent/process/src/services/coding-agent.service.ts (the canonical read service)
#   modules/coding-agent/contract/src/coding-agent.ts                        (codingAgents.sessionsList)
#   modules/coding-agent/process/src/rules/coding-agent-gates.rules.ts (the title and cost gates)
#   modules/coding-agent/process/src/services/coding-agent-viewer-visibility.service.ts (what resolves the viewer's gates)
#   modules/trace/contract/src/trace-viewer-protections.contract.ts (the shared content-visibility rule)
#   The page and its table live under [gone] src/pages/me/ and
#   [gone] src/components/me/.
#
# Related specs:
#   specs/coding-agent/context-economics.feature    , what the context columns count
#   modules/coding-agent/specs/session-git-context.feature, where the branch set comes from
#   specs/coding-agent/pull-request-linkage.feature , how a branch finds its pull requests
#   specs/coding-agent/terminal-view.feature        , the replay a row opens
#   specs/coding-agent/personal-usage.feature       , the totals card above the table
#
# Motivation: the personal usage card answers "what did I spend this month" in
# four numbers. The next question is always "on what", and until now the only
# way to ask it was to open one session at a time from the traces list, where a
# coding-agent session looks like every other trace. This screen is the list of
# the sessions themselves: one row per session, named by the title the agent
# generated for it, carrying the context economics that decide whether a
# session was cheap or ruinous (peak context, compactions, cache rebuilds, time
# working versus time waiting on the human), and the pull requests it drove.
#
# A session drives more than one branch often enough that remembering only the
# last one loses work: an agent that lands a fix, moves to the next branch and
# opens a second pull request is ONE session with two pull requests. The row
# lists every one of them, in number order, so the reader can go from a session
# to what it shipped.
#
# The title is the one piece of conversation-derived content on the row, and it
# follows the same content visibility every other session surface applies: a
# reader who may not see what the human asked for may not see the one-line
# summary of it either.

Feature: Coding-agent sessions screen

Rule: The page lists my sessions with their context economics

  @unit
  Scenario: The list answers with the sessions of the last ninety days
    Given a personal workspace with coding-agent sessions
    When the sessions list is read
    Then it asks for the sessions of the trailing ninety days
    And it asks for no more sessions than one page can hold

  @unit
  Scenario: A row carries what a session cost in context, not only in tokens
    Given a session that compacted, rebuilt its cache and waited on its human
    When the sessions list is read
    Then the row carries its peak context, compactions and cache rebuilds
    And the row carries the time it worked and the time it waited
    And the row carries its token totals and what they cost

  @integration
  Scenario: The page lists my recent sessions with their context economics
    Given a personal workspace with coding-agent sessions
    When the user opens their Sessions page
    Then each session is one row
    And the row shows its peak context, compactions, cache rebuilds and waiting time

  @integration
  Scenario: Active and waiting time, and compactions and cache rebuilds, share one text size
    Given a session that both worked and waited, and both compacted and rebuilt its cache
    When the user opens their Sessions page
    Then its active and waiting time read at the same text size
    And its compactions and cache rebuilds read at the same text size

  @unit
  Scenario: A viewer who may not price the project reads its sessions without their cost
    Given a viewer without permission to price the project
    When the sessions list is read
    Then every row reports its tokens with no cost

  @integration
  Scenario: A workspace with no sessions says so
    Given a personal workspace with no coding-agent sessions
    When the user opens their Sessions page
    Then the page says no sessions have been recorded yet

  # Parked: the sessions-screen row schema carries no reported-cost field, and an
  # unpriced call's cost reaches it as 0, not blank. The stored session row keeps
  # both figures (pi-model-calls.feature); this screen does not show them yet.
  # becomes @unit
  @unimplemented
  Scenario: A pi session row keeps pi's reported cost apart from the catalogue's
    Given a pi session whose model calls reported their own usage and cost
    When the sessions list is read
    Then it is one row carrying its input, output and cache token totals
    And the row's cost is the catalogue's price for those tokens
    And pi's own reported cost is carried separately, never summed into it
    And a cost the catalogue could not price reads blank rather than zero

Rule: A session row exists once the session says something

  A coding agent that starts and then dies before its first prompt still
  emits lifecycle telemetry: session start, auth errors, config reads. A
  fleet of agents resuming at boot with expired credentials produced twelve
  such rows in one morning, every one untitled with a dash in every column.
  A row that can never say what the session did or even what it was asked
  is noise, so it is not created; the session's records stay stored and the
  row appears the moment a real signal arrives.

  @unit
  Scenario: Lifecycle-only telemetry creates no session row
    Given a session that emitted only lifecycle and error events
    And it never carried a prompt, a model call, a title or a repository
    When its telemetry is folded
    Then no session row is stored

  @unit
  Scenario: The first real signal creates the row
    Given a session whose lifecycle telemetry created no row
    When its first user prompt arrives
    Then the session row is stored
    And it is named by that prompt

  @unit
  Scenario: A session announced with a name is a row from the start
    Given a session its harness already named
    When the session-context record arrives before any prompt
    Then the session row is stored under that name
    # An agent that wedges before its first prompt still shows up,
    # attributable by name, rather than vanishing entirely.

Rule: A session is named by its generated title, else by its first prompt

  Most agents rarely generate a title, so a title-only session list reads as
  a wall of untitled rows. The first thing the user actually asked names the
  session until a generated title arrives; a generated title always wins.

  @unit
  Scenario: A row is named by the title the session generated
    Given a session whose agent generated a title for it
    When the sessions list is read
    Then the row carries that title

  @unit
  Scenario: A session with no generated title is named by the first thing the user asked
    Given a session whose agent never generated a title
    When its first prompt event arrives with the user's own words on its first line
    Then the session is named by the prompt's first line
    And a later prompt does not rename it

  @unit
  Scenario: A generated title replaces the prompt-derived name
    Given a session named by its first prompt
    When the agent generates a title for it
    Then the generated title replaces the prompt-derived name

  @unit
  Scenario: A machine-injected first prompt does not name the session
    Given a session whose first prompt event is machine-injected or withheld
    When the prompt event arrives
    Then the session stays unnamed

  @unit
  Scenario: A first prompt that opens with a markdown heading does not name the session
    Given a session whose first prompt opens with a markdown heading like "## Your skills"
    When the prompt event arrives
    Then the session stays unnamed
    And the next prompt that opens with the user's own words names it

  @unit
  Scenario: A stored name that reads as a markdown heading or a tag is not shown
    Given a session stored before this rule with the name "## Your skills"
    When the user reads its row
    Then the row does not show that name

  @unit
  Scenario: A viewer who may not read captured content gets no session title
    Given a viewer who may not read the project's captured content
    When the sessions list is read
    Then no row carries a title
    And the rest of the row is intact

  @unit
  Scenario: A viewer who may not read captured content gets no title on a trace's session
    Given a viewer who may not read the project's captured content
    When the session a trace belongs to is read for its terminal view
    Then the session carries no title
    And the rest of the session is intact

  @integration
  Scenario: A session with no title is named by its agent and the day it started
    Given a Claude Code session whose agent never generated a title or received a prompt
    When the user reads its row
    Then the row names it "Claude Code session" with the day it started

  # A pi run carries its prompt only with content capture on, so a session sent
  # without it reaches this fallback. The risk is a fallback that reaches for the
  # nearest string it can find and prints a span name or a session id at a human.

  @integration
  Scenario: A pi session falls back to its agent's name rather than to a span name
    Given a pi session folded from pi's own spans
    When the user reads its row
    Then the row names it as a pi session with the day it started
    And it is not named after a span name or pi's session id

Rule: The session's own name outranks every derived title

  Every harness names its sessions and can rename them: claude with --name
  and /rename, codex with its thread names. The capture MIRRORS that name
  on the session-context record, the fold writes the newest name onto the
  one Title column in place, and neither the generated conversation title
  nor the first typed prompt may clobber it. A fleet whose sessions all
  open with the same scripted greeting reads as its agents' names, because
  the launcher names each session through the harness's own flag.

  @unit
  Scenario: The session's own name outranks the generated title
    Given a session whose context record carries its name
    When the agent later generates its own title
    Then the row keeps the name

  @unit
  Scenario: The session's own name outranks the prompt-derived name
    Given a session whose context record carries its name
    When a prompt event arrives carrying a name candidate
    Then the row keeps the name

  @unit
  Scenario: A renamed session renames its row
    Given a session named by its harness
    When a later context record carries a different name
    Then the row wears the newest name

  @unit
  Scenario: A blank name does not rename the session
    Given a session named by its harness
    When a later context record carries a whitespace name
    Then the row keeps the name it already had

  # A launcher that runs the agent itself (a hosted agent platform, a CI job)
  # may not run a LangWatch capture hook at all. It names its sessions the
  # OpenTelemetry way instead: OTEL_RESOURCE_ATTRIBUTES carries
  # langwatch.session.name, and every record the agent exports carries it too.

  @unit
  Scenario: A launcher names its sessions through the resource attributes
    Given an agent launched with langwatch.session.name "Scout" in OTEL_RESOURCE_ATTRIBUTES
    When one of its prompt events arrives
    Then the record contributes the name "Scout"

  @unit
  Scenario: A name on the record itself outranks the resource's name
    Given an agent launched with langwatch.session.name "Scout" in OTEL_RESOURCE_ATTRIBUTES
    When a record arrives that carries the name "pr-reviewer" itself
    Then the record contributes the name "pr-reviewer"

  @unit
  Scenario: A blank resource name names nothing
    Given an agent launched with a whitespace langwatch.session.name
    When one of its prompt events arrives
    Then the record contributes no name

  @unit
  Scenario: Any record that carries a name names the session
    Given a session with no context record
    When a prompt event arrives carrying the name "Scout" and the first line "## Your skills"
    Then the row wears the name "Scout"
    And a later generated title does not replace it

  @unit
  Scenario: A launcher's name does not undo a harness rename
    Given a session named "Scout" by its launcher
    When a context record renames it "pr-reviewer"
    And a later prompt event still carries the launcher's name "Scout"
    Then the row keeps the name "pr-reviewer"

  @unit
  Scenario: The session's own name is the title the list shows
    Given a stored session row named by its harness
    When the sessions list is read
    Then the row's title is that name

  @unit
  Scenario: A row from before the source column still takes a generated title
    Given a session row stored before the title source column existed
    When the agent generates a new title
    Then the row wears the generated title

Rule: A session lists every pull request it drove

  @unit
  Scenario: A session that worked on two branches lists both of their pull requests
    Given a session that reported two branches, each with its own pull request
    When the sessions list is read
    Then the row lists both pull requests
    And they are listed in number order

  @unit
  Scenario: The pull requests of a whole page are looked up in one call
    Given a page of sessions spanning several repositories and branches
    When the sessions list is read
    Then the pull requests are looked up once for the whole page

  @unit
  Scenario: A session recorded before branches were remembered falls back to its last branch
    Given a session row written before the branch set existed
    When the sessions list is read
    Then the pull requests of the branch it ended on are still found

  @unit
  Scenario: A workspace whose organization has no GitHub connection still lists its sessions
    Given a personal workspace whose organization never connected GitHub
    When the sessions list is read
    Then every session is listed with no pull requests

  @integration
  Scenario: A session with no pull request reads as none
    Given a session whose branch has no pull request
    When the user reads its row
    Then the pull request cell reads as absent

  @integration
  Scenario: A pull request number opens what the change cost, not GitHub
    Given a session row that lists a pull request
    When the user chooses the pull request number
    Then the pull request's detail opens over the table
    And the replay of the session does not open
    # The reader is on this screen to read spend, so the number leads to the
    # same detail the pull requests screen opens, which is where every
    # session that worked on that change is added up. GitHub is one click
    # further, in that detail's own header.

  @integration
  Scenario: A pull request number is drawn as something to choose
    Given a session row that lists a pull request
    When the user reads the row
    Then the number is underlined

Rule: The table narrows, sorts and pages

  @integration
  Scenario: The table narrows to the sessions matching a search
    Given a page of sessions from several repositories
    When the user searches for one of them
    Then only the matching sessions stay listed

  @integration
  Scenario: Every column sorts, and sorting has a way back
    Given a listed page of sessions
    When the user sorts by a column and then clears the sort
    Then the table returns to the order it opened in

  @integration
  Scenario: The table pages through more sessions than fit at once
    Given more sessions than one page shows
    When the user moves to the next page
    Then the following sessions are listed

Rule: Clicking a session replays it in the terminal

  @integration
  Scenario: Choosing a session opens its terminal replay
    Given a listed session
    When the user chooses its row
    Then the session's terminal replay opens

  @integration
  Scenario: A session whose traces are filed under its launcher's thread still replays
    Given a session launched by a tool that names each trace's conversation after its own thread
    When the user chooses its row
    Then the session's latest stored trace opens in the terminal replay
    And the reader is not told that nothing was stored

  @unit
  Scenario: The session's latest stored trace is found through its own trace map
    Given a session whose traces were mapped to it as they arrived
    When the latest turn of the session is asked for
    Then the newest mapped trace is answered with the time it occurred
    And a session with no mapped trace answers nothing

  @unit
  Scenario: A trace the session's telemetry only named is skipped for one that was stored
    Given a session whose newest mapped trace came from a log record whose trace was never stored
    And an older mapped trace of the session that was stored
    When the latest turn of the session is asked for
    Then the older stored trace is answered
    And the reader never opens a trace that is not found

  @integration
  Scenario: The repository answers a session's newest mapped traces, newest first
    Given a session with more mapped traces than one read asks for
    When the session's recent traces are read with a limit
    Then the newest traces are answered newest first, up to the limit

  @unit
  Scenario: The replay opens on the session's newest stored turn, not the first page of its history
    Given a session whose conversation holds more traces than one page of turns
    When the user chooses its row
    Then the replay opens on the session's newest stored trace

  @integration
  Scenario: Leaving the replay returns to the table as it was
    Given an open terminal replay reached from the table
    When the user closes it
    Then the table is where it was, still sorted and narrowed the same way

  @unit
  Scenario: The replay reads the session's own workspace, not the last project visited
    Given a user whose last visited project is not their personal workspace
    When they choose a session row
    Then the replay reads the session's workspace

  @unit
  Scenario: Moving between turns stays in the session's workspace
    Given an open terminal replay of a session in another workspace
    When the reader moves to another turn of the same session
    Then the replay still reads the session's workspace

  @unit
  Scenario: A replay opened fresh after closing reads the ambient project again
    Given a terminal replay that was opened and then closed
    When a trace is opened from a project's own pages
    Then it reads the project the reader is in

Rule: A session can be replayed from wherever it is listed

  The Sessions table is not the only place a reader meets a session. The pull
  request detail lists the sessions that drove it, and a reader who has just
  seen which ones they were is the reader most likely to want to read one, so
  those rows open the same replay through the same path rather than being a
  table of facts with no way out of it.

  @integration
  Scenario: Choosing a session from the pull request drawer opens its replay
    Given an open pull request detail listing the sessions that ran on it
    When the user chooses one of those session rows
    Then that session's terminal replay opens
    And it reads the workspace the pull request was read in

  @integration
  Scenario: Leaving the replay returns to the pull request it was opened from
    Given a terminal replay opened from the pull request detail
    When the user closes the replay
    Then the pull request detail is on screen again

  @integration
  Scenario: A session with nothing stored says so instead of opening an empty replay
    Given a session row on the pull request detail whose turns were never stored
    When the user chooses it
    Then they are told the session stored none of its turns
    And no replay opens

Rule: A link can open a session's replay on the Sessions page

  Another tool (Laze's Investigate button) links straight to one session. The
  link adds `session=<id>`, `sessionName=<name>` for the newest session with
  that name, or both (the id first, the name when the id is not listed), to
  `/<project>/sessions`. It combines with `langy=open` and
  `langyPrompt=<text>` to have Langy ready with a question about the session.

  @integration
  Scenario: A session link opens that session's terminal replay
    Given a listed session "session-1"
    When the user opens the Sessions page with "session=session-1"
    Then the session's terminal replay opens
    And the address no longer has "session"

  @integration
  Scenario: A session name link opens the newest session with that name
    Given two listed sessions named "Scout", the newer one updated last
    When the user opens the Sessions page with "sessionName=Scout"
    Then the newer session's terminal replay opens

  @unit
  Scenario: A link with a session id and a name falls back to the name
    Given a link with "session=agent-1" and "sessionName=Scout"
    And no listed session has the id "agent-1"
    And a listed session is named "Scout"
    When the session link is applied
    Then the newest session named "Scout" is the one opened

  @integration
  Scenario: A link to a session that is not listed says so
    Given no listed session is named "Ghost"
    When the user opens the Sessions page with "sessionName=Ghost"
    Then they are told the session is not listed here
    And no replay opens
    And the address no longer has "sessionName"

  @unit
  Scenario: A session link keeps the Langy question beside it
    Given a link with "session=session-1", "langy=open" and "langyPrompt=Why so many tokens?"
    When the session link is applied
    Then only "session" is removed from the address
    And "langy" and "langyPrompt" stay for Langy to apply

Rule: A helper thread the agent ran for itself is not a session

  Codex generates a thread title, and a recap, on a hidden thread of its own
  with its own thread id, through the same telemetry exporter as the session
  it serves. Every one of those turns used to list as an untitled session
  beside the real one, with a withheld prompt as its only content. The fold
  marks such a session auxiliary; the row is kept and priced on its own
  trace, and the list never shows it.

  @integration
  Scenario: An auxiliary session is not listed
    Given a codex session and the auxiliary helper session its title came from
    When the sessions list is read
    Then the helper session is not in the list
    And the codex session is

  @integration
  Scenario: A second session started seconds later is listed on its own
    Given two codex sessions the user started seconds apart, neither auxiliary
    When the sessions list is read
    Then both sessions are listed

  @integration
  Scenario: A run of helper threads does not shorten the list
    Given more auxiliary helper sessions than a page holds, all started after
      the user's own sessions
    When a page of the sessions list is read
    Then the page holds as many user sessions as it asked for

  @integration
  Scenario: A session marked auxiliary after it was first stored drops out of the list
    Given a session whose first stored version was not yet marked auxiliary
    When a later version marks it auxiliary
    And the sessions list is read
    Then the session is not in the list
