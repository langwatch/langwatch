Feature: The checkup page of a self-hosted install
  Settings, Checkup answers one question no other screen answers: is this
  install correctly wired. Each row reports one of three verdicts: pass, fail,
  or not checked. Not checked is an answer in its own right and is never shown
  as a pass. A fail names what to do and links the page that explains it.

  The cheap checks run when the page opens. The checks that cost egress or
  money run only when an administrator asks for them. The page also shows the
  exact usage report this install sends, with the switches that shrink it.

  As an administrator of a self-hosted install
  I want to see what is reachable, what is broken, and exactly what leaves the install
  So that I can fix my deployment and answer my own security review

  Background:
    Given a self-hosted install

  # ============================================================================
  # Three verdicts
  # ============================================================================

  @unit
  Scenario: A check that could not run reads as not checked, never as a pass
    Given a check whose probe throws before it can answer
    When the checkup runs
    Then the row reads not checked
    And the row says why it could not run

  @unit
  Scenario: A failed check names the fix and the page that explains it
    Given Postgres answers but a migration is still pending
    When the checkup runs
    Then the migrations row reads fail
    And the row names the command that applies the migration
    And the row links a docs page

  @unit
  Scenario: Every docs page a checkup row links to exists
    Given the docs pages the checkup rows link to
    Then each one is a page in the published docs

  @unit
  Scenario: Every row carries one of the three verdicts
    When the checkup runs
    Then every row reads pass, fail or not checked
    And no row is missing

  # ============================================================================
  # Cheap checks run on page load
  # ============================================================================

  @unit
  Scenario: The install row names the release and the process role
    Given the install runs release "2026.9.3" as the "all" process
    When the checkup runs
    Then the install row reads pass and names both

  @unit
  Scenario: Redis that does not answer is a fail with the address it was tried at
    Given Redis does not answer at its configured address
    When the checkup runs
    Then the Redis row reads fail
    And the row names the address

  @unit
  Scenario: The Redis address is shown without its password
    Given REDIS_URL carries a password
    When the checkup runs, with Redis answering and with Redis not answering
    Then the Redis row names the host and port
    And the row never shows the password

  @unit
  Scenario: A ClickHouse install where the goose binary is absent leaves migrations not checked
    Given ClickHouse answers a ping
    And the goose binary is not on this install
    When the checkup runs
    Then the ClickHouse row reads pass
    And the ClickHouse migrations row reads not checked

  @unit
  Scenario: The usage report row reads the last report and its refusal
    Given the last usage report was refused with "usage_report_refused_413"
    When the checkup runs
    Then the usage report row reads fail
    And the row names the refusal

  @unit
  Scenario: Usage reporting switched off is not checked rather than failed
    Given usage reporting is switched off with DISABLE_USAGE_STATS
    When the checkup runs
    Then the usage report row reads not checked
    And the row says the variable that switched it off

  @unit
  Scenario: A license that names no hosted service leaves the connect rows unblocked rather than failed
    Given the organization holds a license that names no hosted service
    When the checkup runs
    Then the connect row reads not checked
    And the row says what a license with hosted services gives
    And the row names the activation code as the way in

  @unit
  Scenario: Connect switched off by the deployment is not checked with the variable named
    Given the deployment sets LANGWATCH_CONNECT_DISABLED
    When the checkup runs
    Then the connect row reads not checked
    And the row names LANGWATCH_CONNECT_DISABLED

  @unit
  Scenario: A connected install shows its last sync
    Given the organization holds a connected license that synced an hour ago
    When the checkup runs
    Then the connect row reads pass
    And the row names when the last sync happened

  # ============================================================================
  # Explicit checks behind a button
  # ============================================================================

  @unit
  Scenario: The explicit checks do not run on page load
    When the cheap checkup runs
    Then no request leaves the install
    And the rows that cost egress read not checked with the reason that they were not asked for

  @unit
  Scenario: Reaching the connect host names the host and port a firewall rule must allow
    Given the connect host cannot be reached
    When the explicit reachability check runs
    Then the connect host row reads fail with code "connect_unreachable"
    And the row names the host and the port

  @unit
  Scenario: A host that answers with any status is reachable
    Given the gateway host answers 404 to a probe
    When the explicit reachability check runs
    Then the gateway host row reads pass

  @unit
  Scenario: The model provider test respects the organization's egress budget
    Given the organization has used its model provider test budget for the minute
    When the explicit model provider check runs
    Then the model provider row reads not checked
    And the row names when to try again

  @unit
  Scenario: The storage probe writes and deletes one object
    Given a storage destination that accepts writes
    When the explicit storage check runs
    Then one object is written and then deleted
    And the storage row reads pass

  @unit
  Scenario: The SMTP check mentions credentials only when it sent some
    Given an SMTP relay that accepts the connection
    When the explicit SMTP check runs with an SMTP user configured
    Then the row says the server accepted a connection and the credentials
    When the explicit SMTP check runs with no SMTP user configured
    Then the row says the server accepted a connection, with no mention of credentials

  @unit
  Scenario: A canary that needs an input it was not given is not checked
    Given no scenario run plan was named
    When the explicit canaries run
    Then the scenarios row reads not checked
    And the row says which input it needs

  @unit
  Scenario: A gateway that reaches this app by its in-cluster address passes the control plane check
    Given the app's public address is "http://localhost:5560"
    And the app is also reached in the cluster at "http://langwatch-app:5560"
    And the gateway reports its control plane as "http://langwatch-app:5560"
    When the explicit gateway control plane check runs
    Then the gateway control plane row reads pass

  @unit
  Scenario: A gateway that reports another install as its control plane fails the check
    Given the gateway reports its control plane as "http://other-app:5560"
    And "http://other-app:5560" is none of the addresses this app is reached at
    When the explicit gateway control plane check runs
    Then the gateway control plane row reads fail with code "checkup_gateway_control_plane_mismatch"

  # Not yet on this branch: see the merge of #8326 (a peer operation is needed).
  @unit @unimplemented
  Scenario: The Langy canary asks the same access question the Langy panel asks
    Given Langy is open to everyone in this install
    And the Langy API key surface is switched off
    When the explicit Langy canary runs as the administrator who asked for it
    Then one Langy turn is sent as that administrator
    And the Langy row reads pass

  # Not yet on this branch: see the merge of #8326 (a peer operation is needed).
  @unit @unimplemented
  Scenario: The Langy canary is not checked for someone Langy is not open to
    Given Langy is not open to the administrator who asked for the checkup
    When the explicit Langy canary runs
    Then no Langy turn is sent
    And the Langy row reads not checked

  # Not yet on this branch: see the merge of #8326 (a peer operation is needed).
  @unit @unimplemented
  Scenario: The Langy canary honours an email-domain rollout rule
    Given Langy is open only to users of the administrator's email domain
    When the explicit Langy canary runs as that administrator
    Then one Langy turn is sent

  @unit
  Scenario: The model provider test reads the provider's stored key
    Given an OpenAI provider whose key is stored encrypted
    When the checkup reads the organization's providers
    Then the provider test is given the decrypted key

  @unit
  Scenario: A provider that cannot be tested says why
    Given the only configured provider stores no key
    When the explicit model provider check runs
    Then the model provider row reads not checked
    And the row says the provider has no key stored

  # Not yet on this branch: see the merge of #8326 (a peer operation is needed).
  @unit @unimplemented
  Scenario: A provider whose keys will not decrypt fails the checkup
    Given a provider whose stored keys will not decrypt, as after a CREDENTIALS_SECRET change
    When the model provider checks run
    Then both model provider rows fail and name the decryption failure
    And no provider test call is made

  # ============================================================================
  # What we send
  # ============================================================================

  @unit
  Scenario: The page shows the exact report the install would send
    When the usage report preview is taken
    Then it is the same payload the sender would post
    And it names the host the report goes to

  @unit
  Scenario: The two switches change the preview
    Given an administrator switches the optional category off
    When the usage report preview is taken
    Then the preview carries no optional field

  # Ops health: counts the ops dashboard, the process explorer and the
  # migrations page already read, so LangWatch can see an install struggling.

  @unit
  Scenario: The report carries the install's ops health as counts
    Given the ops pages read a queue backlog, dead letters, a blocked group, a stalled process and a parked migration
    When the usage report is taken with the optional category on
    Then the report carries ops_health
    And it counts pending jobs and dead letters per queue, by our own queue name
    And it counts pending jobs, blocked groups, pending messages, dead letters and stalled processes per pipeline, by our own pipeline name
    And it counts parked and rolled back organizations per in-place migration, by the migration's name
    And it carries the failed job counter and when the dashboard last measured
    And a queue, pipeline or migration with nothing wrong is left out

  @unit
  Scenario: Ops health carries no ids, payloads, error messages or tenant names
    Given the ops pages read an error message, a group id and a parked tenant naming a project
    When ops health is read for the report
    Then it carries none of them, and no writer name either

  @unit
  Scenario: An unreadable ops health section is reported as unknown, not as healthy
    Given the dashboard has no reading yet and the migrations cannot be read
    When ops health is read for the report
    Then those sections are null rather than empty
    And the rest of the report still goes

  @unit
  Scenario: Ops health is part of the optional category
    Given an administrator switches the optional category off
    When the usage report is taken
    Then the report carries no ops_health

  @unit
  Scenario: DISABLE_USAGE_STATS sends no ops health either
    Given DISABLE_USAGE_STATS is set
    When the daily report runs
    Then ops health is not read
    And nothing is posted

  @unit
  Scenario: The preview shows ops health like every other field
    When the usage report preview is taken
    Then the payload shows ops_health exactly as it would be posted

  @integration
  Scenario: The checkup page lists every row with its verdict
    When an administrator opens Settings, Checkup
    Then every cheap check is listed with a verdict
    And a not checked row is not coloured as a pass
    And the page links the ops dashboard rather than repeating it

  @integration
  Scenario: The checkup page is listed beside License and Connect on a self-hosted install
    When the settings menu is built for a self-hosted install
    Then "Checkup" is listed with the other install pages
    And it is not listed on LangWatch Cloud

  @integration
  Scenario: The usage report preview is copyable
    When an administrator opens the what we send section
    Then the payload is shown pretty printed
    And a copy button copies it
    And the two switches are beside it
