Feature: Azure Blob stored-objects authenticate without a shared account key

  Issue #6087, follow-up to #4133 (AC37). The Azure Blob write destination
  ships speaking SharedKey (account-key HMAC) only. Enterprises routinely set
  `allowSharedKeyAccess=false` on storage accounts — often enforced by Azure
  Policy — which makes the backend unusable rather than degraded: every
  request returns 403 no matter how it is configured.

  The enterprise path is Microsoft Entra ID. The workload presents an OAuth
  bearer token instead of an HMAC signature, and data access comes from an
  RBAC role assignment ("Storage Blob Data Contributor") rather than from
  possession of a key.

  Locked decisions:

  - Auth mode is an EXPLICIT toggle (`AZURE_BLOB_AUTH_MODE`), never inferred
    from which variables happen to be present — the same reasoning that made
    `STORED_OBJECTS_BACKEND` explicit in #4133. Supported values:
    `sharedKey` (default, unchanged from #4133), `workloadIdentity` (AKS
    federated service-account token), `managedIdentity` (IMDS, for Azure VM /
    VMSS / App Service self-hosters), `azureCli` (developer laptops).
  - AKS is the only federated-Kubernetes target for this rung. Clusters
    without the azure-workload-identity webhook are an explicit non-goal;
    those operators use `managedIdentity` or stay on `sharedKey`.
  - ONE function resolves Azure credentials for every consumer. Today three
    sites decide independently — the destination resolver, the read-driver
    registration in the stored-objects factory, and the dataset storage
    implementation — and each has its own notion of what "configured" means.
    A second source of truth here is a write outage, not a style problem.
  - Browser-direct upload to Azure stays out of scope: dataset staging keeps
    minting a same-origin URL, so no user-delegation-key role is needed.

  Scenarios tagged @unimplemented describe behaviour this rung specifies but
  does not yet verify automatically. Issue #6087 tracks them; a tag comes off
  together with the test that binds its scenario.

  # ---------------------------------------------------------------
  # One credential decision, consumed everywhere
  # ---------------------------------------------------------------

  @unit
  Scenario: A resolvable Azure destination always comes with a usable Azure driver
    Given any supported combination of Azure backend and auth-mode configuration
    When the destination resolver and the storage-driver registration are both consulted
    Then either both report Azure as usable, or neither does
    And no configuration exists where writes resolve to Azure while the driver is unregistered

  @unit
  Scenario: Adding an auth mode forces every Azure credential construction site to be revisited
    Given the Azure credential type distinguishes the supported auth modes
    Then a construction site that handles only shared-key credentials fails to compile
    And each site obtains its credentials from the shared resolver rather than reading environment variables itself

  # ---------------------------------------------------------------
  # Auth mode selection
  # ---------------------------------------------------------------

  @unit
  Scenario: Azure authentication defaults to shared key when no mode is set
    Given STORED_OBJECTS_BACKEND is azure with an account name, key, and container
    And AZURE_BLOB_AUTH_MODE is not set
    When the Azure driver is constructed
    Then it signs requests with the shared account key exactly as before
    And deployments created under issue #4133 observe no change in behaviour

  @unit
  Scenario Outline: Each supported auth mode selects its own credential source
    Given STORED_OBJECTS_BACKEND is azure
    And AZURE_BLOB_AUTH_MODE is <mode>
    And that mode's prerequisites are satisfied
    When the Azure driver is constructed
    Then it authenticates using <credential_source>
    And it never requires AZURE_BLOB_ACCOUNT_KEY unless the mode is sharedKey

    Examples:
      | mode             | credential_source                            |
      | sharedKey        | the configured account key                   |
      | workloadIdentity | a federated service-account token exchange   |
      | managedIdentity  | the instance metadata identity endpoint      |
      | azureCli         | the developer's signed-in Azure CLI identity |

  @unit
  Scenario: An unrecognized AZURE_BLOB_AUTH_MODE value is rejected, not ignored
    Given AZURE_BLOB_AUTH_MODE is set to a value outside the supported set
    When the environment is validated
    Then validation fails with an error naming the variable and the supported values

  @unit
  Scenario: A shared account key configured alongside a token-based mode is refused
    Given AZURE_BLOB_AUTH_MODE is a token-based mode
    And AZURE_BLOB_ACCOUNT_KEY is also configured
    When the configuration is validated
    Then it fails, stating that the key would be ignored and must be removed
    And the operator is never left guessing which credential is actually in use

  @unit
  Scenario: An auth mode configured while Azure is not the backend is refused
    Given AZURE_BLOB_AUTH_MODE is set to a token-based mode
    But STORED_OBJECTS_BACKEND is not azure
    When the configuration is validated
    Then it fails, stating the setting has no effect without the azure backend

  # ---------------------------------------------------------------
  # Misconfiguration diagnostics
  # ---------------------------------------------------------------

  @unit
  Scenario: Missing federated identity input names the operator-actionable cause
    Given AZURE_BLOB_AUTH_MODE is workloadIdentity
    And the platform-injected federated identity values are absent
    When the destination resolver runs
    Then it raises a configuration error
    And the error explains that the pod is missing the workload-identity label, the service-account client-id annotation, or the cluster webhook
    And it does not instruct the operator to set the injected variables by hand

  @unit
  Scenario: Missing shared-key configuration still names the missing variable
    Given AZURE_BLOB_AUTH_MODE is sharedKey
    And AZURE_BLOB_ACCOUNT_KEY is not set
    When the destination resolver runs
    Then it raises a configuration error naming AZURE_BLOB_ACCOUNT_KEY
    And the error states that the shared-key mode required it

  # ---------------------------------------------------------------
  # Bearer-token request signing
  # ---------------------------------------------------------------

  @unit
  Scenario: Every Azure Blob operation carries a bearer token in a token-based mode
    Given the driver is in a token-based auth mode with a valid access token
    When it issues a get, put, delete, exists, head, or container-create request
    Then each request carries an Authorization header of the Bearer scheme
    And no request carries a SharedKey signature
    And each request declares a storage API version that supports Entra authentication

  @unit
  Scenario: Bearer authorization is identical regardless of endpoint addressing style
    Given the driver is in a token-based auth mode
    When it signs the same operation against a host-style and a path-style endpoint
    Then both requests carry the same Authorization header
    And neither carries a SharedKey signature

  @unit
  Scenario: A token-based mode refuses a non-HTTPS blob endpoint
    Given AZURE_BLOB_AUTH_MODE is a token-based mode
    And AZURE_BLOB_ENDPOINT points at a plaintext HTTP address
    When the driver is constructed
    Then it fails, naming the endpoint variable and the transport requirement
    And a bearer token is never transmitted over the plaintext connection

  # ---------------------------------------------------------------
  # Sovereign and non-public clouds
  # ---------------------------------------------------------------

  @unit
  Scenario: A sovereign-cloud storage endpoint obtains tokens from the matching authority
    Given a storage endpoint in a sovereign cloud
    And a configured identity authority host and token audience for that cloud
    When a token is acquired
    Then it is requested from the configured authority, not the public-cloud default
    And it is scoped to the configured storage audience

  @unit
  Scenario: A sovereign-cloud endpoint without a matching authority is refused
    Given a storage endpoint outside the public cloud
    And no identity authority host is configured
    When the driver is constructed
    Then it fails, explaining that a sovereign endpoint requires a matching authority host
    And it does not silently request a token from the public-cloud authority

  # ---------------------------------------------------------------
  # Token lifecycle
  # ---------------------------------------------------------------

  @unit
  Scenario: An access token is reused across operations rather than re-fetched per call
    Given the driver is in a token-based auth mode
    And a token has already been acquired and is still valid
    When several storage operations run
    Then the identity provider is contacted once, not once per operation

  @unit
  Scenario: Projects sharing an identity share a cached token
    Given two projects resolve to the same Azure identity and audience
    When driver instances are constructed separately for each
    Then both reuse the same cached token

  @unit
  Scenario: Projects resolving to different identities never share a token
    Given two projects resolve to different Azure identities
    When driver instances are constructed for each
    Then each acquires and uses its own token
    And one project's token is never presented to the other's storage account

  @unit
  Scenario: Concurrent cold-start operations trigger a single token exchange
    Given the driver is in a token-based auth mode with an empty token cache
    When many storage operations begin simultaneously
    Then exactly one token exchange is performed
    And every operation proceeds with the resulting token

  @unit
  Scenario: An access token is refreshed before it expires rather than after a failure
    Given the cached token expires within the refresh safety margin
    When the next storage operation runs
    Then a fresh token is acquired before the request is issued
    And the operation succeeds without observing an authorization failure

  @unit
  Scenario: The federated assertion is re-read for every token exchange
    Given the driver is in workloadIdentity mode
    And the platform has rotated the projected service-account token on disk
    When a token exchange occurs after the rotation
    Then the exchange uses the rotated assertion read at that moment
    And a long-running worker keeps authenticating after the original assertion expired

  # Throttle backoff is the identity library's job, not ours: it ships a
  # rest pipeline that already honours the provider's Retry-After. Wrapping
  # that in a retry of our own would multiply attempts rather than smooth
  # them — the classic nested-retry storm. What we own is not re-trying on
  # top of it, and surfacing the eventual failure honestly.
  @unit
  Scenario: Throttle backoff is delegated to the identity library, not duplicated
    Given the identity provider rejects a token request as throttled
    When the exchange ultimately fails
    Then the failure is surfaced without an additional retry loop of our own
    And the cache holds no rejected exchange for the next caller to replay

  @unit
  Scenario: A failed token exchange surfaces as a configuration error, not a storage error
    Given the identity provider rejects the credential exchange
    When a storage operation runs
    Then the raised error identifies the token exchange as the failure
    And no credential material appears in the message

  # ---------------------------------------------------------------
  # Authorization failure semantics
  # ---------------------------------------------------------------

  @unit
  Scenario: An expired-token rejection is retried exactly once with a fresh token
    Given a storage request is rejected as unauthenticated despite a cached token
    When the driver reacts
    Then it acquires a fresh token and retries the request once
    And a second consecutive rejection propagates to the caller

  @unit
  Scenario: A permission rejection is not retried and names the missing role assignment
    Given a storage request is rejected because the identity lacks data permissions
    When the driver reacts
    Then it does not acquire a new token or retry
    And the error names the required role assignment and the scope it must be granted on

  # ---------------------------------------------------------------
  # Secret hygiene
  # ---------------------------------------------------------------

  @unit
  Scenario: Authorization material never reaches logs, errors, or traces
    Given any Azure Blob operation fails in any auth mode
    When the failure is reported
    Then the message, log record, and trace attributes contain no Authorization header value
    And they contain no account key or federated assertion
    And storage URIs in the reported text are redacted as they already are elsewhere

  # ---------------------------------------------------------------
  # Byte paths beyond the driver
  # ---------------------------------------------------------------

  @unit
  Scenario: Stored-objects writes succeed in a token-based mode
    Given STORED_OBJECTS_BACKEND is azure in a token-based auth mode
    When byte content is externalized for a project
    Then the object is written and an azure-blob URI is persisted
    And no shared-key configuration is consulted

  @unit
  Scenario: Reads of previously persisted azure-blob URIs succeed in a token-based mode
    Given objects were written under shared-key auth before the switch
    When they are read after the deployment moves to a token-based mode
    Then they resolve through the registered Azure driver

  @integration @unimplemented
  Scenario: Dataset uploads work in a token-based mode
    Given STORED_OBJECTS_BACKEND is azure in a token-based auth mode
    When a dataset is created, appended to, and read back
    Then the chunked content round-trips through Azure Blob
    And no code path dereferences an absent account key

  @integration
  Scenario: The groupQueue durable blob tier works in a token-based mode
    Given the durable blob tier resolves an azure destination in a token-based mode
    When an oversized envelope is offloaded and later read back
    Then the bytes round-trip through Azure Blob

  @unit
  Scenario: Out-of-band maintenance tasks authenticate the same way as the services
    Given a migration or backfill task that writes bytes outside the request path
    Then it obtains Azure credentials from the same shared resolver
    And the deployment documentation states it must run with the same identity as the services

  # ---------------------------------------------------------------
  # Helm surface
  # ---------------------------------------------------------------

  @integration
  Scenario: The chart binds every storage-touching workload to one federated service account
    Given the azureBlob provider is selected with workloadIdentity auth
    When the chart renders
    Then the app, workers, and cronjob pods all name the same service account
    And that service account carries the identity client-id annotation
    And each of those pods carries the label that enables the workload-identity webhook

  @integration
  Scenario: The chart leaves token projection to the platform webhook
    Given the azureBlob provider is selected with workloadIdentity auth
    When the chart renders
    Then it does not hand-mount a projected identity token volume
    And the existing service-account token automount default is unchanged

  @integration
  Scenario: The chart does not require an account key under a token-based mode
    Given the azureBlob provider is selected with a token-based auth mode
    And no accountKey value or secret reference is configured
    When the chart renders
    Then it renders successfully
    And no account-key environment variable is emitted

  @integration
  Scenario: The chart still demands an account key under shared-key auth
    Given the azureBlob provider is selected with sharedKey auth
    And no accountKey value or secret reference is configured
    When the chart renders
    Then rendering fails with an error naming the missing accountKey

  @integration
  Scenario: Installs that do not use Azure render exactly as they did before
    Given a chart configuration that does not select the azureBlob provider
    When the chart renders
    Then the rendered output is byte-identical to the output before this change
    And no service account is introduced for those installs

  # ---------------------------------------------------------------
  # Verification against a real Entra-authenticated account
  # ---------------------------------------------------------------

  @integration @unimplemented
  Scenario: Blobs round-trip against an emulator that accepts only bearer authentication
    Given a storage emulator started in OAuth mode over TLS
    When bytes are written, read back, sized, and deleted through the driver
    Then every request carries bearer authorization
    And no request carries a shared-key signature

  # VERIFIED 2026-07-26 against a real Azure account with
  # allowSharedKeyAccess=false: shared key returned 403
  # KeyBasedAuthenticationNotPermitted, the same operations succeeded on a
  # bearer token. Stays @manual because it needs a subscription and cannot
  # run in CI; bound to a test that self-skips without credentials.
  @manual
  Scenario: Blobs round-trip against a real storage account with shared-key access disabled
    Given a real Azure storage account that forbids shared-key access
    And an identity holding the blob data role on that account
    When bytes are written, read back, sized, and deleted through the driver
    Then every operation succeeds using bearer authentication
    And the same operations attempted with shared-key auth are rejected by the account

  # ---------------------------------------------------------------
  # Documentation
  # ---------------------------------------------------------------

  @unit
  Scenario: Self-hosting docs describe the enterprise authentication path
    Given the self-hosting environment-variables docs
    Then they document AZURE_BLOB_AUTH_MODE and every supported value
    And they name the role assignment the identity requires and the scope to grant it on
    And they state that shared-key configuration is unnecessary in token-based modes
    And they state that federated Kubernetes identity is supported on AKS only
