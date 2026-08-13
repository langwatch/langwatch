Feature: The secrets gate only fails a pull request for what that pull request adds
  As a contributor
  I want the secrets scan to judge my own commits and nothing else
  So that a finding somebody else pushed to their branch cannot block my work

  # The gate is blocking, so its blast radius is the whole merge queue. A scan
  # that reaches outside the branch under test turns one bad commit anywhere in
  # the repository into a red check on every open pull request — which is what
  # happened, and it took a false positive to expose it rather than a real
  # credential.
  #
  # The mechanism is in TruffleHog itself: with no `--branch`, its git source
  # shells out to `git log --all`, i.e. every ref in the clone. `--since-commit`
  # is NOT a scope — it only stops the walk when it happens to reach that exact
  # commit, and `--all` interleaves other refs' newer commits ahead of it.
  # `gitleaks` beside it was already scoped, via `--log-opts=origin/BASE..HEAD`.
  #
  # Both scanners now go through .github/scripts/secrets-scan.sh so the scoping
  # rule is written once and tested, rather than living twice in YAML.
  Background:
    Given the checkout has every branch of the repository present as a remote-tracking ref
    And on a pull request the checkout leaves HEAD detached, with no local branch
    And the scan range is the commits between the merge base and the pull request head

  Rule: A finding outside the pull request's own commits never fails it

    @unit @regression
    Scenario: A secret on an unrelated branch does not fail the pull request
      Given another branch in the same checkout contains a secret
      And the pull request's own commits contain no secret
      When the secrets scan runs
      Then the scan passes

    @unit @regression
    Scenario: A secret already on the base branch does not fail the pull request
      Given the base branch already contains a secret
      And the pull request's own commits contain no secret
      When the secrets scan runs
      Then the scan passes

  Rule: A finding inside the pull request's own commits still fails it

    @unit
    Scenario: A secret the pull request adds fails the check
      Given the pull request's own commits add a secret
      When the secrets scan runs
      Then the scan fails
      And the failure names the file the secret is in

    @unit
    Scenario: A secret the pull request adds and then deletes still fails the check
      Given the pull request adds a secret in one commit and deletes the file in the next
      When the secrets scan runs
      Then the scan fails

  Rule: A scan that reaches nothing is a failure, not a pass

    # Scoping a scanner is one edit away from scoping it to nothing, and a
    # secrets gate that examines zero commits reports exactly the same green
    # check as one that examined them all. This is the assertion that tells the
    # two apart.
    @unit
    Scenario: A scan that examines no content while the pull request changes files fails loudly
      Given the pull request modifies files
      But the scanner reports that it examined no content
      When the secrets scan runs
      Then the scan fails
      And the failure says the scan reached no commits

  Rule: A match that cannot be a credential here is not a finding

    # The false positive that exposed the scoping bug above was TruffleHog's
    # Lob detector: it matches `test_` plus exactly 35 characters, and its
    # verifier accepts the match, so an ordinary shell function arrives as a
    # VERIFIED finding that --only-verified cannot filter. Our chart tests are
    # written entirely in `test_*` functions, so this recurs by construction,
    # and nothing in the repository integrates Lob for the finding to ever be
    # real. The detector is excluded by name, not the files by path, so a
    # genuine credential in those same files is still caught.
    @unit @regression
    Scenario: A shell function name is not a credential
      Given the pull request adds a shell function whose name has the shape of a Lob key
      When the secrets scan runs
      Then the scan passes

  Rule: Both scanners are scoped the same way

    @unit @regression
    Scenario: The pattern scanner ignores a secret on an unrelated branch
      Given another branch in the same checkout contains a secret
      And the pull request's own commits contain no secret
      When the pattern scan runs
      Then the scan passes

    @unit
    Scenario: The pattern scanner still fails on a secret the pull request adds
      Given the pull request's own commits add a secret
      When the pattern scan runs
      Then the scan fails
