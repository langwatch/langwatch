Feature: How the Enterprise single sign-on module installs, gates and records
  As the operator of a self-hosted LangWatch
  I need the single sign-on module to be mounted always, to decide what it
  federates from the licence it can prove, and to leave an audit row for
  exactly the commands that ran
  So that an unlicensed installation degrades to email sign-in rather than to
  a missing route, and the audit trail is neither short of a command that ran
  nor padded with one that was refused

  # ALWAYS MOUNTED, GATED AT RUNTIME. An enterprise route that is only mounted
  # when a licence is present answers 404 to an administrator whose licence
  # has lapsed, which reads as a broken deployment rather than as a licensing
  # fact. The module installs unconditionally and refuses by name.
  #
  # A LICENCE DECISION IS CACHED, A FAILURE IS NOT. Asking the licence store
  # on every request is a network call in the sign-in path, so the answer is
  # held. A FAILED evaluation held the same way pinned an installation to
  # "refused" until it restarted, so a failure is evicted and the next
  # request asks again.
  #
  # THE AUDIT ROW FOLLOWS THE COMMAND, NEVER PRECEDES IT. Recording the
  # attempt and then running it wrote rows for commands that never happened;
  # recording twice on a retry wrote the same act as two. One row, after the
  # ledger answered.

  Rule: a configured process serves the enterprise surface it was installed with

    @unit
    Scenario: A configured process serves the back office's connection ledger
      Given a process with the single sign-on module installed
      When the back office reads the connection ledger
      Then the module serves it

    @unit
    Scenario: A provider without credentials falls back to email
      Given a configured provider that carries no credentials
      When the process resolves how people sign in
      Then it falls back to email

  Rule: what is federated is decided by a licence that can be proved

    @unit
    Scenario: A signed license enables a mounted provider
      Given the licensing service reports genuine access
      When the configured provider is resolved
      Then it is the provider the deployment configured

    @unit
    Scenario: A failed license-store evaluation is retried
      Given a licence evaluation that fails once and then succeeds
      When access is asked for twice
      Then the first answer is a refusal and the second is allowed
      And the failed decision was not kept

  Rule: an audit row is written for exactly the commands that ran

    @unit
    Scenario: A command that succeeds is recorded once, after it ran
      When a command is accepted and the ledger answers it
      Then exactly one audit row is written, after the answer

    @unit
    Scenario: A refused command leaves no audit row
      When a command is refused, whether by the gate or by the ledger
      Then no audit row is written
