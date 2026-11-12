Feature: CI results wake Langy on the pull requests it opened
  Langy cannot run a customer's agent in its sandbox, so the repository's own CI is where a
  change is measured. When every check on the head commit of a pull request Langy opened has
  finished, Langy gets an automatic follow-up turn in the conversation that opened it, to read
  the result and fix, push or report. The follow-up acts as the conversation's owner, holds the
  unattended LangWatch ceiling (view only) and a GitHub token for that one repository. GitHub
  cannot bound an installation token to a branch, so the branch rule is the skill's and the
  repository's branch protection; the platform caps how many follow-ups run in a row.

  Rule: The pull requests a conversation opened are remembered

    @unit
    Scenario: A pull request Langy opened in a turn is linked to its conversation
      Given a completed turn whose `gh pr create` printed the URL of pull request 12 on "acme/agent"
      When the turn's answer is recorded
      Then pull request 12 on "acme/agent" is linked to that conversation, its project, organization and owner

    @unit
    Scenario: A failed pull request command links nothing
      Given a completed turn whose `gh pr create` failed
      When the turn's answer is recorded
      Then no pull request is linked

    @unit
    Scenario: A URL printed by a command that opens no pull request links nothing
      Given a completed turn whose `echo` printed the URL of pull request 12 on "acme/agent"
      When the turn's answer is recorded
      Then no pull request is linked

  Rule: Finished checks on a linked pull request start one follow-up turn

    @unit
    Scenario: Finished checks start a follow-up turn in the conversation that opened the pull request
      Given pull request 12 on "acme/agent" linked to a conversation of a person with Langy access
      When the checks on its head commit are reported finished with a failed check
      Then a turn starts in that conversation as that person
      And its message names the pull request, the branch, the commit, the conclusion and the failed check
      And it says the turn was started automatically, and which follow-up in a row it is

    @unit
    Scenario: A follow-up turn holds a view-only key and a token for the one repository
      Given pull request 12 on "acme/agent" linked to a conversation
      When its follow-up turn is started
      Then the key is minted from the unattended allowlist
      And a GitHub token is asked for the repository "acme/agent" only
      And the turn's prompt offers no UI action

    @unit
    Scenario: The same commit wakes Langy once
      Given a follow-up turn already started for commit "abc123" of pull request 12
      When the checks on commit "abc123" are reported finished again
      Then no second turn starts

    @unit
    Scenario: A pull request no conversation opened wakes nothing
      Given checks finished on pull request 7 on "acme/agent" that no conversation linked
      When the fact is handled
      Then no turn starts

    @unit
    Scenario: A link from another organization wakes nothing
      Given pull request 12 on "acme/agent" linked to a conversation in organization "org-a"
      When the checks are reported finished for an installation of organization "org-b"
      Then no turn starts

  Rule: Automatic follow-ups are capped and reset by the person

    @unit
    Scenario: Follow-ups stop at the cap of automatic turns in a row
      Given pull request 12 already had the maximum number of automatic follow-ups in a row
      When the checks on a new commit are reported finished
      Then no turn starts

    @unit
    Scenario: A turn the person sends resets the count
      Given pull request 12 had automatic follow-ups in its conversation
      When a turn the person sent in that conversation completes
      Then the count of follow-ups in a row for pull request 12 starts again from zero

    @unit
    Scenario: A follow-up turn completing does not reset the count
      Given pull request 12 had one automatic follow-up
      When that follow-up turn completes
      Then the count stays at one

  Rule: A follow-up acts only for a person who may still act

    @unit
    Scenario: A deactivated owner gets no follow-up
      Given pull request 12 linked to a conversation whose owner was deactivated
      When the checks are reported finished
      Then no turn starts

    @unit
    Scenario: An owner without Langy access gets no follow-up
      Given pull request 12 linked to a conversation whose owner Langy is not released to
      When the checks are reported finished
      Then no turn starts

    @unit
    Scenario: A conversation busy with another turn is retried later
      Given pull request 12 linked to a conversation with a turn in flight
      When the checks are reported finished
      Then the handling fails so it is delivered again
      And the commit can still wake Langy on the next delivery
