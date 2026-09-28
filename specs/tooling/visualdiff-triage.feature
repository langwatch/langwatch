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
