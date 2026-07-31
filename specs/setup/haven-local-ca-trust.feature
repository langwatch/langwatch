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

  @unimplemented
  Scenario: the CLI trusts a private root without being told where it is
    reading the CA at runtime would remove the ordering trap entirely, but node's
    fetch has no supported hook for it — undici's dispatcher is not a dependency
    of the SDK, and --use-system-ca does not see the portless root. left alone
    rather than papered over with a re-exec.
    Given a private root the machine trusts but node does not
    When the CLI runs with no CA variable set
    Then it still completes the request
