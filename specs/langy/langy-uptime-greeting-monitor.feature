Feature: An uptime monitor that proves Langy answers a greeting

  The status page needs one question answered on a schedule: can the assistant
  still reply? An external monitor (Better Stack) answers it by starting a real
  Langy turn itself — `POST /api/langy/conversations` with a project API key,
  a fixed greeting, and `Prefer: wait=<seconds>` so the reply comes back in the
  same response. Nothing in the platform is added for this: the surface already
  exists (langy-api-key-turns.feature), and the monitor is the client.

  The one thing a plain HTTP monitor cannot do is the reason this is a scripted
  monitor. Every turn request must carry an `idempotencyKey`, and the platform
  resolves a repeated key for the same project and user to the turn it already
  ran — without running the assistant again. A monitor that sends the same body
  every check therefore replays check one forever and stays green through an
  outage. The check must mint a key no earlier check used, which only a script
  can do.

  The check is two pieces: a pure module that builds the request and classifies
  the response (unit-tested, the source of truth for what "healthy" means), and
  the Better Stack script that is pasted into the monitor and mirrors it. A
  provisioning script creates or updates the monitor from that file, so the
  monitor in Better Stack never drifts from the repo by hand-editing.

  # ---------------------------------------------------------------------------
  # The request
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Every check starts a turn no earlier check could have started
    Given two consecutive checks against the same deployment with the same key
    When each builds its greeting request
    Then the two requests carry different idempotency keys
    And the key is not derived from the greeting, the time, or the credential

  @unit
  Scenario: The request is the plain-text turn shape with a bounded wait
    Given a deployment base URL and a Langy user API key
    When the greeting request is built
    Then it posts to the conversation-start route of the deployment
    And it authenticates with the key in the X-Auth-Token header
    And it asks for synchronous delivery with a wait under the monitor's timeout
    And the body is one user message carrying the fixed greeting as plain text

  @unit
  Scenario: A trailing slash on the base URL does not double the path
    Given a base URL ending in a slash
    When the greeting request is built
    Then the request URL has exactly one slash between host and path

  # The credential travels in a header on every check, from a monitor that runs
  # outside the deployment. A plaintext origin would publish it on every check.

  @unit
  Scenario: A plaintext base URL is refused before the key is attached
    Given a base URL whose scheme is not https
    When the greeting request is built
    Then the build fails saying the base URL must use https
    And no request carrying the credential is produced

  @unit
  Scenario: A base URL that is not a URL at all is refused by name
    Given a base URL that does not parse as a URL
    When the greeting request is built
    Then the build fails saying the base URL is not a valid URL

  # ---------------------------------------------------------------------------
  # Classifying the answer — healthy means one thing only
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A settled turn with reply text is healthy
    Given a 200 response whose body carries a settled turn and a non-empty reply text
    When the response is classified
    Then the check is healthy
    And it carries the conversation id, turn id, and reply text for the check log

  @unit
  Scenario: A settled turn that failed is unhealthy even though the transport said 200
    Given a 200 response whose body has a failed turn status and a null reply
    When the response is classified
    Then the check is unhealthy with reason turn_failed
    And the turn's own error is carried as the detail

  @unit
  Scenario: A reply with no text is not a reply
    Given a 200 response whose reply text is empty or whitespace
    When the response is classified
    Then the check is unhealthy with reason empty_reply

  @unit
  Scenario: An accepted turn that did not settle inside the wait is unhealthy
    Given a 202 response carrying only the accepted turn's ids
    When the response is classified
    Then the check is unhealthy with reason not_settled
    And the accepted turn's ids are carried so the run can be found afterwards

  @unit
  Scenario: A dark surface is named, not mistaken for an outage of the assistant
    Given a 404 response
    When the response is classified
    Then the check is unhealthy with reason surface_dark

  @unit
  Scenario: A refused credential is named by which gate refused it
    Given a 401 response
    When the response is classified
    Then the check is unhealthy with reason unauthorized
    Given a 403 response instead
    When the response is classified
    Then the check is unhealthy with reason forbidden

  @unit
  Scenario: Any other status is unhealthy and keeps the status for the alert
    Given a response with a status the contract does not define, such as 500 or 429
    When the response is classified
    Then the check is unhealthy with reason unexpected_status
    And the numeric status is carried

  @unit
  Scenario: A body that is not the turn envelope is unhealthy, whatever the status
    Given a 200 response whose body is not a JSON object with the turn fields
    When the response is classified
    Then the check is unhealthy with reason malformed_body

  # ---------------------------------------------------------------------------
  # Running the check end to end
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A network failure is unhealthy with the cause, not a crash
    Given the deployment cannot be reached
    When the check runs
    Then the check is unhealthy with reason unreachable
    And the failure message is carried as the detail

  @unit
  Scenario: A non-JSON response body is unhealthy with reason malformed_body
    Given the deployment answers 200 with a body that is not JSON
    When the check runs
    Then the check is unhealthy with reason malformed_body

  @unit
  Scenario: The check reports how long the turn took and which key it used
    Given a deployment that answers healthily
    When the check runs
    Then the outcome carries the elapsed milliseconds
    And the idempotency key it minted, so the turn can be found in the platform

  @unit
  Scenario: The credential never appears in the check's output
    Given a check run with a known API key
    When the outcome is formatted for the check log
    Then the formatted line does not contain the key

  # ---------------------------------------------------------------------------
  # The Better Stack script mirrors the module
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The pasted script cannot drift from the check module
    Given the Better Stack script file in the repo
    Then it sends the same greeting text and the same wait as the module
    And it names every failure reason the module can produce
    And it mints its idempotency key with a random UUID per run
    And it raises the Playwright test timeout past the wait, so a slow turn fails with a named reason rather than a test timeout

  # ---------------------------------------------------------------------------
  # Provisioning the monitor idempotently
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The monitor payload is a single-region Playwright monitor bounded under its own frequency
    Given the provisioning configuration
    When the monitor payload is built
    Then the monitor type is playwright and the script is the repo's script file
    And the base URL and API key travel as monitor environment variables, not in the script
    And exactly one region is set
    And the request timeout does not exceed the check frequency

  @unit
  Scenario: An unknown region or a timeout above the frequency is refused before any API call
    Given a configuration with a region outside Better Stack's set, or a timeout above the frequency
    When the monitor payload is built
    Then provisioning fails with a message naming the field

  @unit
  Scenario: A monitor that does not exist yet is created
    Given no monitor with the configured name exists
    When provisioning runs
    Then one monitor is created with the payload
    And the result names the action as created and carries the monitor id

  @unit
  Scenario: A monitor that already exists is updated in place, never duplicated
    Given a monitor with the configured name exists
    When provisioning runs
    Then that monitor is updated with the payload
    And no monitor is created

  @unit
  Scenario: Two monitors with the configured name is an error, not a coin flip
    Given two monitors carry the configured name
    When provisioning runs
    Then provisioning fails naming the ambiguity
    And nothing is written

  @unit
  Scenario: A dry run shows the payload with the credential redacted and writes nothing
    Given provisioning is invoked as a dry run
    When it runs
    Then the payload is printed with the API key replaced by a placeholder
    And no create or update request is sent

  @unit
  Scenario: A refusal from the monitoring API surfaces its status and message
    Given the monitoring API answers a write with a 4xx and an error body
    When provisioning runs
    Then provisioning fails carrying that status and message

  # ---------------------------------------------------------------------------
  # Live proof
  # ---------------------------------------------------------------------------

  @e2e @unimplemented
  Scenario: The provisioned monitor proves a deployed Langy answers, and pages when it cannot
    Given the monitor is provisioned against a deployment with the flag on and a cohort user's key
    When it runs on its schedule
    Then each check starts a new turn visible in that project's Langy history
    And a check is healthy within the monitor's timeout
    And a check against a stopped Langy worker is unhealthy with reason not_settled
