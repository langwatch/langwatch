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

  Rule: gc removes what dead runs left behind

    @unit
    Scenario: gc leaves a live run, a kept run and the run doing the collecting
      Given run directories whose process is alive, one marked keep, and the current run
      When gc selects what to remove
      Then none of them is selected, and their stacks are not orphans

    @unit
    Scenario: The newest dead run keeps its report
      Given two dead runs
      When gc selects what to remove
      Then both lose their worktrees and stacks, and only the older loses its directory

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
      Given visualdiff.yaml sets concurrency routes to 4
      When a side captures its routes
      Then four pages of one signed-in session each take the next route as they free up
      And a candidate whose shell does not render stops every page taking another route

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
      And it skips the install and generated files when the commit's tree matches the last finished prepare
      And a worktree another live or kept run holds is not shared; that run gets one of its own
      And teardown destroys both stacks in the background and removes no persistent worktree
      And gc never collects the persistent worktrees

    @unit
    Scenario: A baseline is keyed on what changes a capture, and replays only what it covers
      Given a cached baseline for the base commit
      When a route is added, the scheduling changes or a day passes
      Then the key is the same
      And a settle, fixture, viewport, capture source or UI serving change moves it
      And a plan with a route or flow step the baseline never recorded renders the base live

    @unit
    Scenario: The candidate captures while the base is still booting
      Given both sides boot live and the first edition is the one the seed wrote
      When the candidate is ready and seeded
      Then the runner starts it at once and opens the base when its pending file arrives
      And the run adopts the base's address and fixtures once capture ends
      And a base that never comes up stops the runner with its reason

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
