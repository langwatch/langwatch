@unit
Feature: trusting a haven stack from outside haven
  every hostname a stack serves is signed by the portless Local CA. node and bun
  ship their own root list and consult neither the macOS keychain nor
  --use-system-ca, so a JS process that dials app.<slug>.langwatch.localhost dies
  at the handshake with "self signed certificate in certificate chain".

  haven already handed the CA to the children it spawns, so the app never hit
  this. anything haven does NOT spawn did — notably the langwatch CLI a developer
  runs by hand in their own terminal, which is the thing agent onboarding is
  meant to be exercised with.

  the fix is one variable in the overlay. the trap is that it cannot be applied
  from inside the process: node reads NODE_EXTRA_CA_CERTS once at startup, so
  loading .env.portless with dotenv sets it and still fails. it has to be in the
  environment before the command runs.

  publishing the variable is only half of it though. a per-package "cli:haven"
  script only helps the one package that carries it, and the two fallbacks we
  used to document (dotenv -e, and set -a) are a third and fourth spelling of
  the same idea, so `haven exec` owns it instead — one command, any directory,
  and the environment comes from the same dotenv layers the app itself reads.

  Scenario: the local CA is published to tools haven does not spawn
    Given a stack running behind the portless proxy
    Then the generated .env.portless names the CA that signs its hostnames
    And a stack with no local CA publishes nothing, because outside portless the
      real root list is already correct

  Scenario: an untrusted certificate says which variable fixes it
    Given the CLI is pointed at a host whose certificate it does not trust
    When it fails
    Then it names NODE_EXTRA_CA_CERTS and shows the shape of the fix
    And it says the variable must be set before the command runs, since setting
      it afterwards silently does nothing
    And it blames the machine it happened on, not the platform

  Scenario: one command runs anything against the stack
    Given a worktree whose stack has written its overlay
    When the developer runs "haven exec -- node ./some-script"
    Then the command runs with the dotenv layers the app itself reads, .env then
      .env.portless
    And that includes the CA variable, set before the process starts, so the
      ordering trap above cannot be reached by hand
    And haven becomes the command rather than wrapping it, so its exit code,
      signals and terminal are the command's own

  Scenario: arguments after the terminator belong to the command
    When the developer runs "haven exec -- pnpm vitest run --watch"
    Then "--watch" reaches vitest instead of being rejected as an unknown haven flag
    And the terminator is the CLI's, not exec's, so it reads the same way on every
      command that takes arguments
    And a command that declares no arguments still refuses them, terminator or not

  Scenario: an inline variable still wins over the overlay
    Given DATABASE_URL exported in the developer's shell
    When they run "haven exec -- node ./some-script"
    Then the exported value wins, which is how haven already resolves its own knobs
    And the overlay supplies only the variables the shell did not

  Scenario: the langwatch CLI has a one-word spelling
    When the developer runs "haven cli onboard"
    Then this repo's langwatch CLI runs against this stack, with the environment
      "haven exec" would have given it
    And when the CLI has not been built the failure says which command builds it,
      rather than surfacing a missing file

  @unimplemented
  Scenario: the CLI trusts a private root without being told where it is
    reading the CA at runtime would remove the ordering trap entirely, but node's
    fetch has no supported hook for it — undici's dispatcher is not a dependency
    of the SDK, and --use-system-ca does not see the portless root. left alone
    rather than papered over with a re-exec.
    Given a private root the machine trusts but node does not
    When the CLI runs with no CA variable set
    Then it still completes the request
