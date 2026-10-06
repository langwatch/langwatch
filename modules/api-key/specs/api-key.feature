Feature: API key lifecycle
  @unit
  Scenario: A minted key can authenticate once
    When a key is created
    Then its plaintext token is returned
    And verification returns the key without exposing its secret

  @unit
  Scenario: No API key is minted while an operator acts as another member
    Given an operator acting as a member of an organization
    When the session asks to create a personal or a service API key
    Then permission_denied is returned with status 403
    And no key is minted and no token is returned

  @unit
  Scenario: A member acting as themselves still mints API keys
    Given a member signed in as themselves
    When they create a personal API key
    Then the request is not refused as an impersonated mint and goes on to the membership check

  @integration
  Scenario: A view-only member lists only their own API keys
    Given a member with organization:view and no organization:manage permission
    When they list API keys through the organization credential door
    Then only their own keys are read

  @unit
  Scenario: A revoked or expired key cannot authenticate
    When a key is revoked or expires
    Then verification rejects its token

  @unit
  Scenario: A personal key cannot exceed its owner's live grants
    When a key is created with a project or team binding
    Then every requested permission is checked at that resolved scope
    And a permission outside the owner's ceiling is rejected

  @unit
  Scenario: A built-in role is checked as every permission it confers
    Given a member who holds organization:view but not the rest of the organization Member role
    When a key with an organization Member binding is created for them
    Then the create is refused

  @unit
  Scenario: A restricted key nobody answers for is refused
    When a restricted key is created with no owner, no creator and no requesting key
    And it is not a platform-managed key
    Then the create is refused and nothing is written

  @unit
  Scenario: A revoked key is refused before its grants are retracted
    When a key is revoked
    Then the key is marked revoked and its shared answer refused before its grants are removed

  @unit
  Scenario: A service key without bindings defaults to organization administration
    When an unowned service key is created without bindings
    Then it receives one organization ADMIN binding

  @unit
  Scenario: A system-managed key is not customer-addressable
    When a customer uses the reserved Langy session name
    Then creation, rename, read and revoke are rejected as not found or reserved

  @unit
  Scenario: A customer key named like a system key stays visible and manageable
    Given a customer key created before "Workflow run" was reserved, carrying that name
    When its owner lists, edits or revokes it
    Then it is listed and the edit and revoke succeed
    And only a key the system minted is hidden, and calls with it never act as the system
    And no new key, and no rename, may take the name

  @unit
  Scenario: Replacing grants is fail-safe
    When replacement grants are attached
    Then the previous grants are revoked only after the new grants exist
    And a failed grant write leaves the previous access intact

  @unit
  Scenario: A CLI device login replaces only older keys for that device
    When a CLI login key is minted
    Then older keys for the same user, organization and device are revoked
    And a newer concurrent key is not revoked

  @unit
  Scenario: The API-key transport moves without changing who may call it
    Given the API-key procedures are owned by the API-key package
    When the process mounts them on its own tRPC root
    Then the browser calls the same procedure names as before
    And every procedure declares the same access decision it declared before

  @unit
  Scenario: An API-key binding identifier is minted by the feature
    When a key's grant needs an AuthZ binding identifier
    Then the feature package mints it
    And it carries the same resource prefix a member's binding carries
    And no composition root describes that prefix

  @unit
  Scenario: An API-key grant warning reaches the process logger
    Given a process supplies a named logger to the API-key service
    When a grant the service expected to revoke is already gone
    Then the logger receives the context and the message unchanged

  # The agent-sandbox sweep. A sandbox key is minted per code agent run and
  # nothing retires it at the end of one, so the hourly sweep is the only thing
  # that revokes an elapsed key. It runs cross-tenant and by predicate, which is
  # why the predicate is spelled out here rather than left to the query: a
  # widened one revokes customer keys across every organization at once.

  @unit
  Scenario: The sandbox sweep revokes only elapsed sandbox keys
    Given a sandbox key whose lifetime has passed
    When the sweep runs
    Then the key is revoked as of the moment the sweep read the clock
    And only keys carrying the reserved sandbox name are considered

  @unit
  Scenario: The sandbox sweep leaves live and already-revoked keys alone
    Given a sandbox key that has not yet elapsed and one already revoked
    When the sweep runs
    Then neither key is written again

  @unit
  Scenario: A key with no expiry is never swept
    Given a sandbox-named key created without an expiry
    When the sweep runs
    Then the key is left untouched

  @unit
  Scenario: The sandbox sweep reports how many keys it retired
    Given three elapsed sandbox keys
    When the sweep runs
    Then it answers three

  @unit
  Scenario: The worker composes the sandbox sweep from the feature package
    Given a worker graph composed with the process database
    When the API-key feature installs
    Then it registers the agent-sandbox maintenance pipeline
    And the pipeline's sweep runs the feature's own revoke

  # The CLI login-key parent cascade. A personal ingest key minted by a CLI
  # device session carries `parentApiKeyId`, so revoking the session's login
  # key (a person's own revoke, a re-login, or the session running out)
  # retires the keys minted under it too — from the API-keys page, the REST
  # route, the tRPC mutation and the hourly sweep alike, since the cascade
  # lives on the revoke primitive rather than in any one caller.

  @unit
  Scenario: Revoking a login key retires its ingest keys
    Given a login key with ingestion keys minted under it
    When a person revokes the login key
    Then each ingest key minted under it is also revoked
    And the ingest keys record that the session went, cause "session", not that someone chose them

  @unit
  Scenario: A cause other than a person's own revoke passes through to the children unchanged
    Given a login key with an ingestion key minted under it
    When the login key is revoked with cause "rotation"
    Then the ingestion key is revoked with the same cause "rotation"

  @unit
  Scenario: A cascade that fails does not fail the revoke that triggered it
    Given a login key whose children cannot be read
    When the login key is revoked
    Then the revoke still reports the login key as revoked

  @unit
  Scenario: A cascade does not recurse past one level
    Given a login key with one ingestion key minted under it
    When the login key is revoked
    Then the cascade looks for children exactly once

  @unit
  Scenario: A key minted as its session is being retired does not outlive it
    Given an ingestion key parented to a login key
    When the login key is revoked or its session has expired
    Then verifying the ingestion key's token is refused
    And verifying it while the login key is still live succeeds

  # The CLI login-key sweep. A session the CLI stops refreshing leaves Redis
  # by TTL, which runs no code, so this hourly sweep is what retires its
  # login key — and, through the ordinary revoke cascade, the ingest keys
  # parented to it.

  @unit
  Scenario: The CLI login-key sweep retires elapsed sessions and their ingest keys
    Given a CLI login key whose session has run out
    When the sweep runs
    Then it revokes the key through the feature's own revoke, not a raw update
    And a row with no user is skipped rather than failing the sweep
    And a key another caller already revoked is tolerated

  @unit
  Scenario: The worker composes the CLI login-key sweep from the feature package
    Given a worker graph composed with the process database
    When the API-key feature installs
    Then it registers the CLI login-key sweep on the agent-sandbox maintenance pipeline
    And the pipeline's sweep revokes through the installing graph's own app

  # Device labels. One derivation serves the CLI login key and every ingest
  # key minted under it, so the two carry the same label and a devices
  # listing can show a key beside the session that minted it.

  @unit
  Scenario: A device label is reduced to the charset a key name carries
    Given a free-form device label with characters a key name cannot carry
    When the label is sanitized
    Then it is lowercased, trimmed to 24 characters and stripped of stray dashes

  @unit
  Scenario: A session with neither a chosen label nor a hostname is unknown-device
    Given a device session whose client_info carries neither field
    When its label is derived
    Then it reads "unknown-device"

  @unit
  Scenario: A session's login-key expiry tracks the sooner of the refresh window and the org ceiling
    Given an organization with a maximum session duration
    When a login key's expiry is computed
    Then it is the sooner of the refresh window from now and the ceiling from the session start
    And a session already past the ceiling does not slide forward on a later refresh

  @unit
  Scenario: Tightening the organization's session ceiling brings live login keys forward and retires elapsed ones
    Given an organization whose live CLI login keys expire after the new ceiling from their session start
    When an admin lowers the maximum session duration
    Then each live login key expires at the ceiling from its session start
    And a login key already past the ceiling is revoked with cause expired and counted

  @unit
  Scenario: Clearing the session ceiling leaves refresh windows alone and still retires elapsed login keys
    Given an organization with a live login key and an elapsed one
    When an admin sets the maximum session duration to zero
    Then the live login key keeps its expiry
    And the elapsed login key is revoked and counted

  @unit
  Scenario: A login key retired by the session ceiling counts even when its ingest keys cannot be read
    Given an elapsed login key whose minted ingest keys cannot be read
    When the session ceiling is applied
    Then the login key is revoked and counted

  @unit
  Scenario: A restricted API key reads back the permissions of its private role
    Given a restricted key whose CUSTOM binding points at its own private role
    When the key is read back by id
    Then its permissions are the private role's permissions, as main reports them

  @unit
  Scenario: A key minted by someone holding a grant on an archived team keeps the minter's role
    Given a member holding grants on a live team and on an archived team
    When the member's grants are named for the create-key drawer
    Then the read answers and names the live team
    And the archived team's grant has no scope name
    And the create-key drawer shows an error and disables Create when the read fails

  @unit
  Scenario: Only a platform-minted key with no owner may be bound to a personal workspace it is not owned in
    Given a personal workspace owned by one member
    When the platform mints a system-managed key with no owner bound to that workspace
    Then the binding is accepted and the key acts as no person
    And a key a person asked for, with no owner or another owner, is still refused there

  @unit
  Scenario: A pre-2025 legacy API key still authenticates on every header
    Given a project whose legacy API key is an opaque value from before December 2024, starting "eyJ"
    When it is sent as a bearer, as basic auth, or as X-Auth-Token
    Then it authenticates as that project's legacy API key
    And it is matched as an opaque string, never verified as a JWT
