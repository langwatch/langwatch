# See ../../../dev/docs/adr/131-secrets-are-not-config.md
Feature: Secrets resolve through a source chain, not from the environment directly

  As a platform operator
  I want every credential to arrive through an ordered chain of named sources
  So that a laptop can hold no long-lived provider key and a pod keeps reading
  exactly the environment Kubernetes gave it

  Rule: The classification is data, and it is the same list everywhere

    @unit
    Scenario: Every rotating credential is classified as a secret
      Given the secret registry
      When it is read
      Then it names twenty-nine secret keys and ten composite keys

    @unit
    Scenario: An unlisted key is configuration
      Given a key the registry does not name
      When its class is asked for
      Then it is configuration

    @unit
    Scenario: Only the keys the generate scripts write are marked generate
      Given the secret registry
      When the generate-on-first-run keys are read
      Then they are the gateway trio and the langy internal secret

  Rule: Redaction depends on the class, not on the value

    @unit
    Scenario: A secret becomes the marker
      Given a secret key and its value
      When the value is prepared for a log line
      Then it reads as the redaction marker and carries none of the value

    @unit
    Scenario: A composite URL keeps its shape and loses its credential
      Given a database URL with a username, a password and a query string
      When the value is prepared for a log line
      Then the scheme, host, port and path survive and the userinfo and query do not

    @unit
    Scenario: A composite value that is not a URL is redacted whole
      Given a composite key whose value cannot be parsed as a URL
      When the value is prepared for a log line
      Then it reads as the redaction marker

    @unit
    Scenario: A configuration value passes through
      Given a key the registry does not name
      When the value is prepared for a log line
      Then it is unchanged

  Rule: The chain is ordered and says who answered

    @unit
    Scenario: The first source with an answer wins
      Given two sources that both hold a key
      When the chain resolves it
      Then the value is the first source's and the second source is never asked for it

    @unit
    Scenario: A blank value counts as absent
      Given an environment holding a secret key set to an empty string
      When the chain resolves it
      Then no source answered for that key

    @unit
    Scenario: The chain reports the source by name and never the value
      Given a chain that resolved a secret
      When its attribution is read
      Then each entry carries the key name and the source name only

    @unit
    Scenario: Refusal names every missing required key
      Given a required key no source can answer for
      When the chain resolves it
      Then boot is refused with the key named and no candidate value in the message

  Rule: 1Password is opt-in and never reached in production

    @unit
    Scenario: An op reference in the environment is resolved
      Given a secret key whose value is an op:// reference
      When the 1Password source resolves it
      Then the CLI is asked once for the batch and the referenced value is returned

    @unit
    Scenario: A missing secret is looked up under the configured profile
      Given a vault is named and a secret key has no value
      When the 1Password source resolves it
      Then it asks for the key under the langwatch item for the configured profile

    @unit
    Scenario: The profile defaults rather than being keyed on the worktree
      Given a vault is named and no profile is set
      When the 1Password source builds its reference
      Then the item is the dev profile item

    @unit
    Scenario: Being signed out is not a miss
      Given the CLI exits non-zero because the session is not unlocked
      When the 1Password source resolves a key
      Then it fails with the unlock instruction rather than falling through

    @unit
    Scenario: An item that does not exist falls through to the next source
      Given the CLI reports that no item matched
      When the 1Password source resolves a key
      Then it answers nothing and the chain carries on

    @unit
    Scenario: Production never constructs the 1Password source
      Given a production environment with a vault named
      When the environment is resolved
      Then no subprocess is run

  Rule: Resolution happens before the runtime parses its configuration

    @unit
    Scenario: The resolved environment is a new frozen record
      Given an environment holding configuration and secrets
      When it is resolved
      Then a frozen copy is returned and the process environment is not mutated

    @unit
    Scenario: An unconfigured checkout resolves nothing and still boots
      Given an environment holding no classified secret
      When it is resolved
      Then the summary says nothing was resolved and no refusal is raised

  Rule: With a vault configured, a first launch writes into it rather than onto disk

    @unit
    Scenario: Generated development secrets are written to the vault, not to .env
      Given a first launch with a vault configured and writing opted into
      When the dev-only secrets are generated
      Then each generated key is written into the profile item and none reaches .env

    @unit
    Scenario: A provider key is never invented
      Given a key the registry does not mark generate
      When the generating source resolves it
      Then it answers nothing and writes nothing

    @unit
    Scenario: The item is created when it does not exist yet
      Given a vault holding no item for this profile
      When a generated secret is written
      Then the item is created after the edit misses

  Rule: Moving the secrets already in .env into the vault is an explicit act

    @unit
    Scenario: Migrating .env moves the secrets and leaves configuration alone
      Given a .env holding provider keys, a password and configuration
      When it is pushed to the vault
      Then the secret lines become op:// references and every configuration line is unchanged

    @unit
    Scenario: A key already holding a reference is left alone
      Given a .env line that is already an op:// reference
      When it is pushed to the vault
      Then it is reported as already referenced and nothing is written

    @unit
    Scenario: Keeping the file leaves it byte for byte
      Given a push asked to keep the file
      When it runs
      Then the vault is written and the file text is unchanged

  Rule: Tooling may not write a secret into .env behind the two generate scripts

    @unit
    Scenario: Only the two generate scripts write a secret key
      Given every script under dev/scripts
      When the writes into .env are read
      Then only the AI Gateway and Langy scripts name a secret key
