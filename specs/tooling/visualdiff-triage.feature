# visualdiff drives UI parity the way apidiff drives API parity: every
# screen is either compared or loudly listed as a gap, real regressions fail
# the run, and an agent triages from summary.txt without opening an image.
#
# Bound by Go tests in tools/visualdiff (`go test ./...`), annotated `// @scenario`.

Feature: visualdiff catches regressions and reports its own coverage

  Rule: One classifier decides every screen, in the report and the findings stream alike

    @unit
    Scenario: A screen captured only on the candidate is missing-base, never changed
      Given a screen the candidate captured and the base never did
      When the row is classified
      Then it is a "missing-base" finding

    @unit
    Scenario: A step that fails on both refs is a finding
      Given a flow step whose action fails on the base and on the candidate
      When the row is classified
      Then it is a "broken-both" finding saying the flow is broken on both

    @unit
    Scenario: A blank page is a finding on every route
      Given the candidate renders a page with no text on any route
      When the row is classified
      Then it is a "blank" finding

    @unit
    Scenario: A candidate ending on a different path is a finding
      Given the base ends on "/p/datasets" and the candidate on "/p/home"
      When the row is classified
      Then it is a "redirect" finding
      And two paths that differ only by a generated id are the same path

    @unit
    Scenario: A new failing API request is a finding whatever its status
      Given the candidate records a 500 on a tRPC call the base does not make
      When the row is classified
      Then it is an "api-error" finding
      And a failure both refs share is not

    @unit
    Scenario: A random id in the final path never reads as a redirect
      Given the base ends on "/p/experiments/workbench/MIHy1lTc" and the candidate on "/p/experiments/workbench/YMcoGt8s"
      When the row is classified
      Then it is not a "redirect" finding

    @unit
    Scenario: A base redirecting an operator screen to governance is expected
      Given the base ends on "/governance" and the candidate on "/ops/backoffice/users"
      When the row is classified
      Then it is "intended-restore", naming the base's redirect
      And a redirect not listed as expected is still a "redirect" finding

    @unit
    Scenario: The join offer's throttle is noise, not a finding
      Given the candidate's join offer answers 429 after the run's many page loads
      When the runner records the screen's failures
      Then neither the 429 nor the browser's console line for it is recorded
      And any other status of the join offer, or a 429 anywhere else, still is

    @unit
    Scenario: The passkey offer is declined before every screenshot and photographed once at sign-in
      Given main raises the passkey offer on every screen
      When a side signs in
      Then the offer is photographed as the "sign-in" flow, an error when it never shows
      And every later capture declines it before its screenshot
      And a replayed baseline keeps the "sign-in" capture whatever flows the plan names

    @unit
    Scenario: The findings stream and the report classify alike
      Given the same captures streamed to findings.jsonl and built into the report
      Then every screen has the same class in both

  Rule: Every screen carries text evidence from its accessibility tree

    @unit
    Scenario: A control one side lacks is a finding
      Given the base shows a "Save" button and the candidate does not
      When the row is classified
      Then it is a "controls" finding naming -button "Save"

    @unit
    Scenario: Different words with the same controls are copy
      Given both refs show the same controls with different text around them
      When the row is classified
      Then it is "copy", which does not fail the run

    @unit
    Scenario: A collapsed layout is a layout finding whatever its words say
      Given the candidate's panes collapse while its controls and words match the base
      When the row is classified
      Then it is "layout", a finding listed beside regressions

    @unit
    Scenario: A small difference in the same layout stays copy
      Given both refs draw the same layout with a few words changed
      When the row is classified
      Then it is "copy"

    @unit
    Scenario: A new background color in the same layout is not a layout finding
      Given the candidate changes only the page's background color
      When the row is classified
      Then it is not "layout"

    @unit
    Scenario: A large pixel difference is a layout finding whatever its words say
      Given the pixel difference between the refs is 10% or more
      When the row is classified
      Then it is "layout"

    @unit
    Scenario: A page that changed size is a layout finding
      Given the two screenshots differ in size
      When the row is classified
      Then it is "layout"

    @unit
    Scenario: Dates, ids and relative times never read as a change
      Given two snapshots that differ only by a date, an id, a count and "3 minutes ago"
      Then the text compares equal

  Rule: Every route either ref declares is rendered or excluded with a reason

    @unit
    Scenario: Every declared route is rendered, excluded or uncovered
      Given main's pages and the branch's screen declarations
      When coverage is computed against visualdiff.yaml
      Then each pattern is covered, excluded with its reason, or uncovered
      And the verdict reads "coverage X/Y" with the uncovered list
      And each uncovered route is an "uncovered" finding in the run

    @unit
    Scenario: A dynamic route renders a seeded fixture or stays uncovered
      Given main declares "/[project]/traces/[trace]" and "/[project]/datasets/[id]"
      And visualdiff.yaml renders "/{slug}/traces/{trace}" filled from the seeded trace id
      Then the trace route is covered and the dataset route is uncovered

    @unit
    Scenario: Each stack seeds the entities its dynamic routes open and keeps its own ids
      Given a stack that answers the dataset, experiment, evaluator, monitor, graph, virtual key and budget REST routes
      When the run seeds that stack
      Then each entity's id the stack generated fills that side's route placeholder
      And the monitor is posted with the seeded evaluator's id and the budget with the seeded virtual key's id

    @unit
    Scenario: An entity a stack refuses is a warning, not a dead run
      Given a stack that refuses the evaluator
      When the run seeds that stack
      Then the seed still succeeds with the other entities' ids
      And a warning names the monitor as not seeded because the evaluator was not

    @unit
    Scenario: A side renders the ids its own seed generated, and a resumed run keeps them
      Given the seed generated a dataset id
      When the run hands the runner its plan
      Then that side's fixtures carry the dataset id over the static fixtures
      And the seeded marker records the ids, so a resumed run renders the same ones

    @unit
    Scenario: A candidate screen's declared path wins over its key
      Given a screen keyed "pages/governance/inventory.enterprise" declaring path "/governance/inventory"
      Then its pattern is "/governance/inventory"

    @unit
    Scenario: An exclusion without a reason is refused
      Given a coverage exclusion with no reason
      When the configuration loads
      Then it is refused naming the route

  Rule: summary.txt is the text an agent triages from

    @unit
    Scenario: summary.txt counts every class per edition and names the worst findings
      Given a run with findings in two editions and uncovered routes
      When the summary is rendered
      Then it counts each class per edition, prints the coverage line
      And lists the worst findings one line each with url, failed request and role diff
      And lists every uncovered route

    @unit
    Scenario: findings.md lists findings only
      Given a run with one finding and one noise row
      When the report is written
      Then findings.md names the finding and not the noise row

  Rule: A flow proves its feature works, and a run says so in one file

    @unit
    Scenario: A flow's expect proves the feature did its job on both sides
      Given a flow whose steps end in an expect (text, count, url, or an api field read with the signed-in session)
      When the expect holds on the base and on the candidate
      Then the flow's verdict is "works" and the expect is recorded as its proof

    @unit
    Scenario: An expect failing on the candidate alone is broken
      Given a flow whose expect holds on the base and fails on the candidate
      When the row is classified
      Then it is a "broken" finding naming what the expect missed
      And an expect failing on the base alone is "intended-restore"

    @unit
    Scenario: An expect that times out fails its step with what it missed
      Given an expect that never holds
      When it has polled for its timeout, with no fixed sleep
      Then its step fails with "expect <description>: <why> after <timeout>ms"

    @unit
    Scenario: verdict.md names each finding's class, first failure, console errors and PNGs
      Given a finished run
      When it writes verdict.md
      Then each flow has one line: works, broken, broken-both, layout-only or unproven
      And a failing flow names its first failure: step, expect, side, and the console signature
      And routes with a finding are listed, and the rest counted as rendered alike, never as working
      And every finding carries its failed step or request, up to three console errors and its base, candidate and diff PNG paths

    @unit
    Scenario: signatures.md splits log signatures new on the candidate from those also on the base
      Given the stacks' logs hold warn, error and fatal lines, JSON or plain
      When a run finishes
      Then signatures.md groups them by shape, ids and numbers masked, with counts and where each was first seen
      And lists those new on the candidate before those also on the base

    @unit
    Scenario: -routes and -flows re-check only what they name
      Given a run naming some routes or flows
      When the configuration is narrowed
      Then only the named routes and flows are captured, an unknown name is refused, and coverage still reads every route

  Rule: gc removes what dead runs left behind

    @unit
    Scenario: gc leaves a live run, a kept run and the run doing the collecting
      Given run directories whose process is alive, one marked keep, and the current run
      When gc selects what to remove
      Then none of them is selected, and their stacks are not orphans

    @unit
    Scenario: A run keeps its own directory and the previous run's, and deletes the rest
      Given dead runs from three earlier starts, a kept run and a directory not named as a run time
      When the gc pass a new run makes selects what to remove
      Then every dead run loses its worktrees and stacks
      And only the newest earlier run keeps its directory; older ones are deleted
      And the kept run and the directory not named as a run time are left alone

    @unit
    Scenario: visualdiff gc removes only reports older than -older-than
      Given dead runs started a month ago and yesterday, and a directory not named as a run time
      When `visualdiff gc -older-than 168h` selects what to remove
      Then only the month-old run loses its directory

    @unit
    Scenario: gc destroys orphan visualdiff stacks no run owns
      Given haven reports a visualdiff stack whose run directory is gone
      When gc runs
      Then it destroys that stack, then prunes the worktrees

    @unit
    Scenario: A dirty HEAD candidate is warned about
      Given the candidate is HEAD and tracked files have uncommitted changes
      When a run starts
      Then stderr warns that the candidate renders the last commit without them

    @unit
    Scenario: A runner that cannot launch its browser stops the run before any stack boots
      Given Playwright's browser is not installed for the runner
      When a run starts
      Then it fails before any worktree is checked out or stack started, naming the install command

  Rule: A run spends its time on screens, not on waiting

    @unit
    Scenario: A request that never reports back does not hold later captures to the deadline
      Given a request that reports neither finished nor failed
      When the page navigates away, or the request is older than three seconds
      Then the settle no longer waits on it
      And a settle that runs to its deadline logs the requests still in flight with their ages
      And each of them, once it ends, logs how long it queued, waited on the server and downloaded
      And a page call with no timeout of its own gives up after five seconds rather than hang a page

    @unit
    Scenario: A side whose first routes all hit the settle deadline warns loudly
      Given each of a side's first five routes runs to the settle deadline
      Then stderr carries one warning naming what was still in flight
      And no warning when any one of them settled

    @unit
    Scenario: A side captures its routes on several pages at once
      Given four pages per side: -pages, half the CPUs by default, or visualdiff.yaml's concurrency when the machine cannot be read
      When a side captures its routes
      Then four pages each take the next route as they free up, each in its own copy of the signed-in session
      And each page closes once its capture is done, so no renderer lives long enough to bloat
      And a candidate whose shell does not render stops every page taking another route

    @unit
    Scenario: A side works on fewer pages while the machine is loaded or a renderer crashed
      Given a side allowed four pages on a machine with ten CPUs
      When the 1-minute load average rises above ten
      Then only the CPUs' share of the four pages takes new work, and never fewer than one
      And each page whose renderer crashes takes one page off the side for the rest of the run
      And the capture that crashed is held back and taken again alone once the others are done

    @unit
    Scenario: check runs on as many pages as the machine has room for
      Given `visualdiff check` with no -pages
      When it plans its flows
      Then it runs them on four pages at most, no more than half the CPUs and one per gigabyte of free memory
      And never on fewer than one

    @unit
    Scenario: check's time left counts only the flows' own pace
      Given a check whose route pass took sixteen minutes
      When nineteen of 210 flows are done seventy seconds into the flows
      Then the time left is paced from the end of the route pass: about twelve minutes, not hours

    @unit
    Scenario: Flows run side by side, and the one editing the project runs last
      Given flows that only read, flows that create, one that filters a view and one that edits the project
      When a side captures its flows
      Then a page takes a read-only flow as soon as no route is left for it
      And the flows that create wait for every route, then use every page, in the configured order
      And the view-filtering flow, then the project-editing flow, run alone once they are done

    @unit
    Scenario: A flow step that fails keeps what blocked it
      Given a flow step whose click timed out
      When its failure is recorded
      Then the finding and run.log carry Playwright's call log after the first line
      And the log keeps what the locator resolved to and what intercepted the click, capped at twenty lines

    @unit
    Scenario: The base boots the moment it is prepared, while the candidate prepares
      Given both sides boot live on haven
      When the run brings them up
      Then the base's haven up runs as soon as its own prepare finishes, before the candidate's checkout
      And each side's UI is built while its stack boots

    @unit
    Scenario: Each side is captured from a production build of its UI, or from its dev server when that fails
      Given a side whose UI built
      When the runner opens it
      Then every document is the built shell carrying the dev shell's public config
      And its assets are served from the build on its own origin, never through the dev server's module graph
      And a side whose build failed is captured from its dev server, which the run log says
      And such a base is never cached as a baseline, and -dev-ui keeps both sides on their dev servers

    @unit
    Scenario: Every run.log line carries its time, and a machine that may sleep is warned about
      Given a run on a Mac on battery or in Low Power Mode
      When the run starts
      Then stderr warns about each, and the run holds an idle-sleep assertion until it ends
      And every line of run.log opens with the time it was written

  Rule: A run reuses what the last one built

    @unit
    Scenario: Each side reuses one worktree between runs and prepares it only when its tree changed
      Given a run on haven whose sides checked out into .visualdiff/worktrees/base and .visualdiff/worktrees/candidate
      When the next run starts
      Then it moves each worktree to its commit in place instead of adding a new one
      And it skips the install when the lockfile inputs match the last finished install, and the generated files and UI build when the code inputs match
      And ensure-built runs every time, after removing a build lock a killed prepare left behind
      And a worktree another live or kept run holds is not shared; that run gets one of its own
      And teardown destroys both stacks in the background and removes no persistent worktree
      And gc never collects the persistent worktrees

    @unit
    Scenario: A baseline is keyed on what changes a capture, and replays only what it covers
      Given a cached baseline for the base commit
      When a route is added, the scheduling changes or a day passes
      Then the key is the same
      And a settle, fixture, viewport, capture source or UI serving change moves it
      And a plan with a route or flow step the baseline never recorded renders only those on the base

    @unit
    Scenario: The candidate captures while the base is still booting
      Given both sides boot live and the first edition is the one the seed wrote
      When the candidate is ready and seeded
      Then the runner starts it at once and opens the base when its pending file arrives
      And the run adopts the base's address and fixtures once capture ends
      And a base that never comes up stops the runner with its reason

  Rule: Main stays put, and a run starts only on a machine that can carry it

    @unit
    Scenario: The base is main pinned at a commit, and the pin moves only when main moved far or is asked to
      Given no -base and a pin recorded in .visualdiff/baselines/main-pin.json
      When a run starts
      Then the base renders the pinned commit, and the run prints the pin and why it did or did not move
      And the pin moves only when `git diff --shortstat pin..origin/main` counts 2000 changed lines or more
      And it moves on -rebase-main, when there is no pin yet, and when the pinned commit is gone

    @unit
    Scenario: Main boots only for what its cached baseline lacks, and the baseline grows by it
      Given a cached baseline at the pinned commit
      When a run adds a route and changes a flow's steps
      Then it prints "main: <edition> cached (N) / live (M, why)"
      And main boots and renders only the new route and the changed flow, alone, before the diff
      And they are added to the baseline, and the diff replays main from it
      And a run with nothing new boots only the candidate

    @unit
    Scenario: A run refuses to start on battery, under load or beside another visualdiff stack
      Given the machine is on battery, its 1-minute load average is above -max-load (20 by default), or another live or kept run's stack is up
      When a run starts
      Then it stops before creating its directory, naming every reason and -force
      And with -force it runs, on no more pages per side than the CPUs the load leaves free

    @unit
    Scenario: Each phase's wall time is on the run log and in summary.txt
      Given a run
      When each phase ends: install, prepare, ui build, boot, seed, capture, recapture, flows, the main top-up and teardown
      Then run.log carries "phase: <name> <duration>"
      And summary.txt ends with every phase's wall time

    @unit
    Scenario: A flow or route whose last verdict was works is skipped while nothing it touches changed
      Given a route with no finding or a flow judged works, recorded in .visualdiff/works.json at its candidate commit
      And the module that touches it is read from the candidate's defineWebModule screen declarations
      When a later run finds git diff since that commit empty over that module's browser, process and contract paths, the shell packages, apps/ui and the runner, and a flow's steps and expects unchanged
      Then it is skipped as the done ledger skips a section, the dry run lists it, and verdict.md says "skipped (works at <sha>, unchanged)"
      And a route no module declares, or a flow with no go step, is walked with the reason printed
      And -include-done, -routes and -flows walk it anyway

    @unit
    Scenario: visualdiff flow re-runs one flow against a kept candidate stack in seconds
      Given main's cached baseline and a candidate stack `visualdiff flow` booted and kept under .visualdiff/loop
      When a fixer runs `visualdiff flow <id>` or `visualdiff route <path>` again after committing an edit
      Then the kept stack is reused, its worktree follows the candidate's commit and re-prepares only what changed
      And only that flow or route is captured and diffed against the baseline, topped up when the baseline lacks it
      And its verdict line prints, and `visualdiff down` stops the stack and removes the loop's directory

    @unimplemented
    Scenario: Screens are diffed and classified in the Go tool on a bounded worker pool
      Given captures arriving from the runner
      When both sides of a screen exist
      Then the pixel diff runs in a Go goroutine pool, not in the runner
      And the runner only drives Playwright

  Rule: A finished run shows its screens on the branch's pull request

    @unit
    Scenario: A run's screens are the key pages, then one finding or change per area, largest first
      Given a run with key pages, findings and changes across several areas
      When its screens are selected for the pull request
      Then every configured key page comes first
      And the findings follow, then the other changes, the largest first
      And no area repeats until every area with a screen to show has one
      And a blank, failed or unloaded capture is never shown

    @unit
    Scenario: A screen that could leak a secret or a local path is never published
      Given a screen whose text on either side holds a key, a token or a local file path
      When its screens are selected for the pull request
      Then that screen is left out

    @unit
    Scenario: The PR comment carries the run, its counts and a gallery gh uploads
      Given the selected screens
      When the comment is rendered
      Then it carries the marker, the run id, both commits and the counts by class
      And each screen shows the candidate beside a readable base, or the candidate alone when the passkey offer covers the base

    @unit
    Scenario: A run rewrites only its own flows' rows of the parity status in the PR body
      Given a pull request body with a "### visualdiff flows" table between the parity-status markers
      When a run publishes
      Then each row whose flow the run covered gets its "last result" and "state" cells from the flow's verdict
      And a covered flow with no row gets one appended, and the heading's count follows
      And every other row, and everything outside the markers, is left byte for byte
      And gh's own output never reaches the body

    @unit
    Scenario: Each run edits the PR's one marked comment in place
      Given the branch's open pull request
      When a run publishes
      Then it posts the comment with its images attached through gh, each scaled to publish.width and cut at publish.maxHeight
      And when the PR already carries the marked comment, that comment takes the posted body and the post is deleted
      And with no open PR, gh signed out, or -no-publish, it logs why and posts nothing
      And `visualdiff publish -run-dir DIR -pr N -link URL` publishes a finished run to the named pull request, linking its report

  Rule: A capture the dev server spoiled is taken again alone, and never read as the product's

    @unit
    Scenario: A blank capture or one whose modules failed to load is taken again alone
      Given a side capturing its routes on several pages at once
      When a capture comes back blank or with its own module requests failed
      Then it is held back and taken again on one page once every other route is done
      And only the retake is reported

    @unit
    Scenario: A screen whose modules still did not load is a capture failure, not a blank page
      Given a capture whose own module requests failed on either side
      When the row is classified
      Then it is "capture-failed", a finding naming the side and the first failed module
      And a live base holding one is not cached as a baseline

  Rule: A signed-off section keeps its proof and is not captured again

    @unit
    Scenario: A section marked done keeps its proof and is skipped by later runs
      Given a finished run whose route or flow is only noise, copy or intended-restore
      When `visualdiff done -run RUNID -route PATH -note WHY` marks it
      Then its screenshots, aria snapshots, console and request log and a meta.json with both commits land under .visualdiff/done/<edition>/<key>
      And every later run skips it, says how many sections it skipped and which, and never counts it as a finding or uncovered
      And -include-done captures it again, and `done -undo KEY` removes it

    @unit
    Scenario: A section with a failing class is refused unless forced
      Given a finished run whose section has a failing class
      When `visualdiff done` marks it without -force
      Then it is refused naming the class, and no entry is written
      And with -force and a note it is marked done and recorded as forced

  Rule: Review batches seal while the run is still going

    @unit
    Scenario: A batch seals every N completed items, and at each phase boundary
      Given a check or run with -batch-size N
      When N routes or flows complete, or a side finishes its routes or its flows, or the runner exits
      Then a batch directory <out>/batches/NNNN-<phase>/ holds batch.json, REVIEW.md and only that batch's screenshots and diffs
      And batch.json names each item's verdict, first failing step, diff scores, console errors and both sides' URLs and timings
      And a route waiting on its pixel diff is not sealed until the diff arrives
      And READY is written last through a rename, a line is appended to batches.jsonl and one is printed on stdout
      And every verdict, exit code and report is the same as without batches

    @unit
    Scenario: A reviewer waits for the next ready batch and never reads a half-written one
      Given batches after the last one reviewed, one without READY
      When `visualdiff batches -wait -after N` runs
      Then it blocks until a batch numbered after N holds READY and prints that batch's path
      And `visualdiff batch-review <dir>` prints its REVIEW.md, and refuses a batch without READY
