Feature: CI results wake Langy on the pull requests it opened
  Langy cannot run a customer's agent in its sandbox, so the repository's own CI is where a
  change is measured. When every check on the head commit of a pull request Langy opened has
  finished, Langy gets an automatic follow-up turn in the conversation that opened it, to read
  the result and fix, push or report. The follow-up acts as the conversation's owner, holds the
  unattended LangWatch ceiling (view only) and a GitHub token for that one repository. GitHub
  cannot bound an installation token to a branch, so the branch rule is the skill's and the
  repository's branch protection; the platform caps how many follow-ups run in a row. Each pull
  request Langy opened is one row, keyed by repository and number, mapped from the answer that
  opened it. How many follow-ups ran in a row since the person last spoke is a count the
  conversation keeps from its own messages.

  Rule: The pull requests a conversation opened are remembered

    @unit
    Scenario: A pull request Langy opened in a turn is linked to its conversation
      Given a completed turn whose `gh pr create` printed the URL of pull request 12 on "acme/agent"
      When the turn's answer is recorded
      Then pull request 12 on "acme/agent" is stored with its conversation, its owner and when it was opened

    @unit
    Scenario: A pull request opened on a GitHub Enterprise Server host is linked too
      Given a deployment whose GitHub App lives on an Enterprise Server host
      And a completed turn whose `gh pr create` printed that host's URL of pull request 12 on "acme/agent"
      When the turn's answer is recorded
      Then pull request 12 on "acme/agent" is stored with its conversation

    @unit
    Scenario: A redelivered answer stores its pull request once
      Given an answer that opened pull request 12 on "acme/agent" was stored
      When the same answer is delivered again
      Then pull request 12 on "acme/agent" keeps its first row

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
      Given pull request 12 on "acme/agent" opened by a conversation of a person with Langy access
      When the checks on its head commit are reported finished with a failed check
      Then a turn starts in that conversation as that person
      And its message names the pull request, the branch, the commit, the conclusion and the failed check
      And it says the turn was started automatically, and which follow-up in a row it is

    @unit
    Scenario: A follow-up turn holds a view-only key and a token for the one repository
      Given pull request 12 on "acme/agent" opened by a conversation
      When its follow-up turn is started
      Then the key is minted from the unattended allowlist
      And a GitHub token is asked for the repository "acme/agent" only
      And the turn's prompt offers no UI action

    @unit
    Scenario: The same commit wakes Langy once
      Given a follow-up turn already started for commit "abc123" of pull request 12
      When the checks on commit "abc123" are reported finished again
      Then the turn's admission answers with the turn already started for that commit
      And no second turn starts

    @unit
    Scenario: A pull request no conversation opened wakes nothing
      Given checks finished on pull request 7 on "acme/agent" that no conversation opened
      When the fact is handled
      Then no turn starts

    @unit
    Scenario: A pull request opened in another organization wakes nothing
      Given pull request 12 on "acme/agent" opened by a conversation in organization "org-a"
      When the checks are reported finished for an installation of organization "org-b"
      Then no turn starts

  Rule: Automatic follow-ups are capped and reset by the person

    @unit
    Scenario: Follow-ups stop at the cap of automatic turns in a row
      Given the conversation that opened pull request 12 already had the maximum number of automatic follow-ups in a row
      When the checks on a new commit are reported finished
      Then no turn starts

    @unit
    Scenario: A follow-up message CI started counts one more in a row
      Given a conversation that opened pull request 12
      When the message of an automatic follow-up turn is recorded
      Then the conversation's count of follow-ups in a row goes up by one

    @unit
    Scenario: A message the person sends resets the count
      Given a conversation that had automatic follow-ups
      When the person sends a message in that conversation
      Then the count of follow-ups in a row starts again from zero

    @unit
    Scenario: A follow-up turn completing does not reset the count
      Given a conversation that had one automatic follow-up
      When that follow-up turn completes
      Then the count stays at one

    @integration
    Scenario: The read model finds the conversation that opened a pull request
      Given the row of pull request 12 on "acme/agent" opened by a conversation
      When CI looks up pull request 12 on "Acme/Agent" within that conversation's project
      Then it finds that conversation and its owner
      And a lookup within other projects finds nothing

  Rule: A follow-up acts only for a person who may still act

    @unit
    Scenario: A deactivated owner gets no follow-up
      Given pull request 12 opened by a conversation whose owner was deactivated
      When the checks are reported finished
      Then no turn starts

    @unit
    Scenario: An owner without Langy access gets no follow-up
      Given pull request 12 opened by a conversation whose owner Langy is not released to
      When the checks are reported finished
      Then no turn starts

    @unit
    Scenario: A conversation busy with another turn is retried later
      Given pull request 12 opened by a conversation with a turn in flight
      When the checks are reported finished
      Then the handling fails so it is delivered again
      And the commit can still wake Langy on the next delivery
