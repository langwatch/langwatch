Feature: Claude's own state, linked to the worktree it came from
  haven already reclaims two of the places an agent fills a disk: the worktrees
  under .claude/worktrees and the job scratch under ~/.claude/jobs. Claude Code
  writes in a dozen more — transcripts per project, file history and shell
  snapshots per session, plugins and caches for the machine — and none of them
  is attached to anything haven knows about. A worktree is deleted and its
  transcripts stay forever under a name nobody recognises; the single largest
  directory on the machine belongs to the primary checkout, which no cleanup
  ever looks at.

  So haven reads them, says which worktree each one belongs to, and speaks up
  only when something old has grown large. It removes none of it: transcripts
  are the record of work, not scratch, and the one thing worse than a full disk
  is a cleanup that ate the notes.

  # Behavior lives in tools/thuishaven:
  #   domain/claudestate.go   — the catalogue of locations, their two roots and
  #     their scopes, the
  #     forward path encoding that links a project directory to its worktree, and
  #     the old-and-large rule that decides whether there is anything to say.
  #   app/claudestate.go      — PlanClaudeState: reading the locations and
  #     linking each one to a live worktree.
  #   adapters/claudestate/   — walks each location for its size, its cold share
  #     and its newest write.
  #   cmd/clean.go            — the report section, and the line a worktree
  #     removal prints about what it left behind.
  # Scenarios are bound by Go tests (`go test ./...` in tools/thuishaven):
  #   domain/claudestate_test.go, app/claudestate_test.go,
  #   adapters/claudestate/claudestate_test.go and cmd/clean_test.go.

  Background:
    Given a machine with several worktrees and a Claude home holding transcripts, caches and session files

  @unit
  Scenario: A project's transcripts are named by the worktree they came from
    Given a transcript directory whose name encodes a worktree's path
    When haven plans the Claude state
    Then the directory is reported against that worktree, not as an unrecognised name

  @unit
  Scenario: A worktree whose path holds dots and dashes still matches its transcripts
    Given a worktree at a path containing a dot directory and hyphenated names
    When haven links the transcript directories
    Then it encodes each worktree's path forward to compare, because the encoded name cannot be decoded back to one path

  @unit
  Scenario: Transcripts whose worktree is gone are reported as left behind
    Given a transcript directory naming a path that no longer exists
    When haven plans the Claude state
    Then it is reported as left behind by a worktree that is gone, and nothing is deleted

  # What the first run of this actually printed: thirty lines about forty
  # kilobytes of skill-test sandboxes, above one dismissive line for the
  # gigabyte. True, and useless.

  @unit
  Scenario: A gone worktree that left almost nothing is counted, not listed
    Given a dozen directories left by test sandboxes, a few kilobytes each
    When the section is printed
    Then they are counted in one line rather than listed, and the largest directory is still named

  @unit
  Scenario: Old and large is the only thing worth interrupting for
    Given one directory that is large but written to this morning, and one that is old but tiny
    When haven decides what to say
    Then neither is called out, because a notice means old bytes and lots of them

  @unit
  Scenario: A directory still in daily use is judged on the age of its bytes, not its own mtime
    Given a transcript directory written to today whose files are mostly a year old
    When haven decides what to say
    Then it names how much of it has sat untouched, rather than treating the whole directory as current

  # The reported gap: a directory in the system temp root, named by the same
  # path encoding, holding a hundred megabytes of per-session working files.
  # Nothing clears it while the machine stays up, and it is not under the home
  # everyone looks in.

  @unit
  Scenario: Claude's working files outside its home are read too
    Given a per-user directory in the system temp root holding one directory per project
    When haven plans the Claude state
    Then those directories are read and linked the same way the transcripts are
    And a child of that root whose name never encoded a path is attributed to the installation, not to a worktree

  @unit
  Scenario: Session-keyed and machine-wide state is named but attributed to no worktree
    Given file history, shell snapshots and the plugin cache
    When haven plans the Claude state
    Then each is named with what it holds and its scope, and none is attached to a worktree

  @unit
  Scenario: The two locations haven already reclaims are not counted twice
    Given the job scratch and the agent worktrees under the Claude home
    When haven plans the Claude state
    Then neither appears in this report, because a cleanup already owns them

  @unit
  Scenario: The report deletes nothing and offers no picker
    Given a cleanup reporting on the Claude state
    When the section is printed
    Then every row says where it is and how big it is, and no row can be ticked

  @unit
  Scenario: Removing a worktree says what it left behind
    Given a worktree that is removed and transcripts recorded against it
    When the removal finishes
    Then it prints where those transcripts are, and leaves them there
