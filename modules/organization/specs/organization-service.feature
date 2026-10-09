Feature: Shared organization service
  Organization, team, and group invariants are implemented once for all features.

  @unit
  Scenario: A caller requires the oldest team
    Given an organization has one or more teams
    When a feature gets the organization's oldest team
    Then the organization service returns the oldest team identifier
    And the caller performs no nullable check

  @unit
  Scenario: An organization has no team
    Given an organization has no team
    When a feature gets the organization's oldest team
    Then the organization service throws the organization-owned no-team error

  @integration
  Scenario: A feature needs organization behaviour
    When the feature is composed
    Then it receives the process-owned organization service
    And it does not query Organization or Team persistence directly

  @unit
  Scenario: A disabled member is checked for active access
    Given the user still has a disabled organization membership
    When a feature checks whether the user is a member without including deactivated members
    Then the organization service returns false
    And the same check can include the retained disabled membership when required

  @unit
  Scenario: Trace sharing is disabled for an organization
    Given trace sharing is currently enabled
    When a management transport commits the organization settings update
    Then the organization service reports that trace-share revocation is required
    And organization records trace sharing disabled after the commit, naming each project
    And share revokes those projects' trace links from its own side

  @unit
  Scenario: A request manages a shared team
    Given an organization-authenticated request has the required team permission
    When it creates, reads, updates, or archives a shared team
    Then the request delegates to the process-owned organization service
    And no service or repository is constructed for that request

  @unit
  Scenario: A request changes team membership
    Given the target is a shared team
    And the user belongs to the organization
    When the request adds or removes the user
    Then the organization service writes the membership through AuthZ grants

  @unit
  Scenario: A request mutates a personal team
    Given the target is a personal workspace team
    When the request archives it or changes its membership
    Then the organization service refuses with the personal-team domain error

  @unit
  Scenario: A request lists a team's related resources
    When the request lists team members or projects
    Then it composes the AuthZ and Project services
    And it does not query role binding or project persistence directly

  @unit
  Scenario: Team membership is projected from grants
    Given a user has more than one binding on the same team
    When the organization service presents the team's members
    Then it derives membership from AuthZ bindings
    And it presents the highest-priority effective role once
    And it preserves the lower-priority additive binding

  @unit
  Scenario: A non-manager reads team membership
    Given the caller belongs to the team but cannot manage it
    When the caller reads the team
    Then the caller can see only their own member email

  @unit
  Scenario: A non-member gets a team by slug
    Given the caller does not belong to the requested team
    When the caller gets that team by slug
    Then the organization service throws the same error as for a missing team

  @unit
  Scenario: A team edit would remove the last administrator
    Given the proposed direct membership leaves no direct administrator
    And no administrator is inherited through a group
    When the organization service validates the edit
    Then it refuses before changing the team or emitting grant commands

  @unit
  Scenario: A group supplies the remaining administrator
    Given the proposed edit removes the last direct administrator
    And a member of an administrator group remains
    When the organization service validates the edit
    Then it accepts the edit

  @integration
  Scenario: Concurrent team membership edits race
    Given two editors read the same team revision
    When the first edit wins the repository revision fence
    Then the second edit is refused as stale
    And only the winning edit emits durable grant commands

  @unit
  Scenario: A team membership write partially fails
    When the service changes direct team membership
    Then replacement access is attached before existing access is changed
    And removed access is revoked last
    And a failure tends toward retaining access rather than unexpectedly removing all access

  @unit
  Scenario: A request manages an organization group
    When Hono or tRPC creates, reads, renames, or deletes a group
    Then it delegates to the process-owned organization service
    And it constructs no request-scoped service or repository

  @unit
  Scenario: A group receives scoped access
    Given the group and scope belong to the same organization
    And any custom role is user-created and assignable at that scope
    When a binding is added to the group
    Then the organization service writes it through the AuthZ grants service
    And no Organization repository reads or writes RoleBinding rows

  @unit
  Scenario: A group batch edit partially fails
    When bindings are removed and group membership is changed in one request
    Then the service revokes access before changing membership
    And it attaches new access only after the group edit succeeds

  @unit
  Scenario: A personal workspace is born with packaged identifiers
    Given a process composes the organization service
    When the service creates a user's personal workspace
    Then the feature package mints the team, project, role binding and ingestion key
    And each identifier carries the resource prefix the existing rows already use
    And the team and the project receive separate slugs seeded from the user identifier
    And no composition root describes any of those formats
    And the personal project id is a fresh strict project KSUID, never derived from the team id

  @unit
  Scenario: Ensuring a personal workspace leaves an existing membership as it was
    Given a person who is already an administrator of the organization
    When their personal workspace is ensured
    Then they still hold exactly one membership in the organization
    And that membership is still Administrator

  @unit
  Scenario: A shared team is born with packaged identifiers
    When the organization service creates a shared team
    Then the feature package mints the team identifier and its role binding
    And the team identifier keeps the shape the existing Team rows carry
    And the slug ends with the leading characters of that identifier

  @unit
  Scenario: An organization group is born with packaged identifiers
    When the organization service creates a group
    Then the feature package mints the group identifier and its role binding
    And the slug it returns carries no identifier tail
    And the service appends its own suffix when the base slug is taken

  @unit
  Scenario: A team or group slug survives a URL
    Given a name containing separators, accents or symbols
    When a team slug or a group slug is minted from it
    Then the result is lower-case ASCII words joined by single dashes
    And a team and a group minted from the same name slug identically

  @unit
  Scenario: A personal-workspace warning reaches the process logger
    Given a process supplies a named logger to the organization service
    When the service reports a personal-workspace diagnostic
    Then the logger receives the context and the message in its own argument order

  @integration
  Scenario: A member's organization listing leaves out the hidden governance project
    Given an organization holding its hidden governance project beside an application project
    When a member's organizations are listed with their projects
    Then the governance project is not among them

  @unit
  Scenario: A changed organization presence setting is recorded as organization's fact
    Given an organization whose presence setting is on
    When an administrator saves the organization settings with presence off
    Then organization records a presence-setting-changed fact with presence off
    And the fact carries the id of the administrator who changed it
    And it is not marked as backfilled

  @unit
  Scenario: Saving organization settings without changing presence records no presence fact
    Given an organization whose presence setting is on
    When an administrator saves the organization settings with presence on, or without the presence field
    Then no presence-setting-changed fact is recorded

  @unit
  Scenario: Both doors that save organization settings name who saved them
    When an administrator saves the organization settings through the settings form or the management API
    Then the organization service is told the member who saved them

  @unit
  Scenario: Existing organizations' presence settings are recorded by the backfill, idempotently
    Given two organizations whose presence settings were stored before organization recorded them
    When organization records every existing organization's stored presence setting twice
    Then each run records each organization's stored presence setting once, marked backfilled, with no changer
    And each organization's fact is keyed alike on both runs, so the second run records nothing new

  @unit
  Scenario: The signed-in person fact may carry an image organization does not read
    Given the process binds the signed-in person with a name, an email and an image
    When organization parses the person for a procedure
    Then it reads the name and the email and leaves the image out

  @integration
  Scenario: The per-file dataset limit an operator stored is read back in bytes
    Given an organization whose largest dataset file is stored as 100 MB
    When the organization's dataset limits are read
    Then the per-file limit answers 104857600 bytes
    And an organization with nothing stored, or an unknown one, answers no limit

  @unit
  Scenario: The memory organization store answers the per-file dataset limit the same way
    Given a memory organization whose largest dataset file is 100 MB
    When the organization's dataset limits are read
    Then the per-file limit answers 104857600 bytes
    And an organization with nothing stored, or an unknown one, answers no limit

  @integration
  Scenario: A licence is stored with the moment it was validated and cleared with both its dates
    Given an organization in Postgres
    When a licence is set with its expiry and the moment it was validated
    Then the organization carries the licence, its expiry and that validated stamp
    And a licence set with no validated stamp stores none
    And clearing the licence empties the licence, its expiry and its validated stamp
    And setting or clearing a licence on an unknown organization refuses with organization not found

  @unit
  Scenario: The memory organization store sets and clears a licence the same way
    Given a memory organization
    When a licence is set with its expiry and the moment it was validated
    Then the organization carries the licence, its expiry and that validated stamp
    And clearing the licence empties the licence, its expiry and its validated stamp
    And setting or clearing a licence on an unknown organization refuses with organization not found

  @unit
  Scenario: An organization's support contact is the one set in its settings, else its longest-seated enabled administrator
    Given an organization whose settings name a support contact
    When its support contact is found
    Then the configured contact answers
    And without one, the email of the earliest-seated administrator who is not disabled answers
    And with no enabled administrator, no contact answers

  @integration
  Scenario: The longest-seated enabled administrator is read from Postgres
    Given an organization whose earliest administrator is disabled, followed by two enabled administrators
    When its first administrator's email is read
    Then the earlier-seated of the two enabled administrators answers
    And an organization with no enabled administrator answers none

  # Organization decides who holds a seat; user owns what a browser session is. Taking a seat is
  # immediate for authorization, while the live sessions end from organization's fact a few
  # seconds later (dev/docs/plans/peer-cycle-cuts-2026-10-06.md §7, ruling R7).
  Rule: Taking a seat refuses the next request at once and records the revocation for user

    @unit
    Scenario: Disabling a member takes their access away before the call returns
      Given an active member of an organization
      When an administrator disables that member
      Then the membership is written and the organization's cached authorization answers retired before the call returns
      And no browser session is ended inline

    @unit
    Scenario: Disabling a member records that their seat was taken away
      Given an active member of an organization
      When an administrator disables that member
      Then the membership is written first
      And organization records that member as disabled, naming who disabled them

    @unit
    Scenario: Re-enabling a member records no seat revocation
      Given a disabled member of an organization
      When an administrator re-enables that member
      Then no seat revocation is recorded

    @unit
    Scenario: Re-enabling a member records that their seat was given back
      Given a disabled member of an organization
      When an administrator re-enables that member
      Then the membership is written first
      And organization records that member as re-enabled, naming who re-enabled them

    @unit
    Scenario: A process that cannot record the seat revocation refuses the disable
      Given a process in which organization's lifecycle pipeline is not registered
      When an administrator disables a member
      Then the disable is refused rather than left without its session revocation

  @unit
  Scenario: A new personal workspace answers pending until project has created its project
    Given a user with no personal workspace in an organization
    When the user's personal workspace is ensured
    Then organization creates the personal team and its owner membership, and no project row
    And it records "lw.organization.personal_team_created" with the team id, a freshly minted project id and the project slug
    And it answers pending with the team to wait on

  @unit
  Scenario: Ensuring again while the personal project is pending creates no second team
    Given a personal team whose personal project has not been created yet
    When the user's personal workspace is ensured again
    Then no second personal team is created
    And it answers pending with the same team
    And it records "lw.organization.personal_team_created" again with a new project id, so a lost record heals

  @unit
  Scenario: Ensuring a personal workspace whose project exists answers ready
    Given a personal team whose personal project has been created
    When the user's personal workspace is ensured
    Then it answers ready with the team and the project, and records nothing

  @unit
  Scenario: The personal team fact never carries the project key
    When organization records "lw.organization.personal_team_created"
    Then the fact carries no API key

  @unit
  Scenario: A mutation that needs a pending personal project refuses as retryable
    Given a personal workspace whose project is pending
    When a caller needs the personal project to make a change
    Then it refuses with "personal_workspace_pending", a retryable handled error, and changes nothing

  @unit
  Scenario: Removing a member records their archived personal teams for project
    Given a member who owns a personal team in an organization
    When an administrator removes the member
    Then organization archives the personal team and writes no project row
    And it records "lw.organization.personal_workspace_archived" with the archived team ids, awaited, so an unrecorded removal fails loudly

  @unit
  Scenario: Ensuring a returning member's workspace records its revival for project
    Given a returning member whose archived personal team organization has revived
    When the user's personal workspace is ensured and answers pending
    Then it records "lw.organization.personal_workspace_revived" with the team id, awaited
    And project revives the archived personal project, while a brand-new team's record changes nothing

  @unit
  Scenario: Switching personal workspace features records them for project
    Given the owner of a personal workspace
    When the owner enables or disables all its features
    Then organization audits the switch and writes no project row
    And it records "lw.organization.personal_workspace_features_changed" with the project id and the new switches, awaited

  @unit
  Scenario: Every way an organization is created records lw.organization.created
    Given an organization is created by sign-up, by instance provisioning or for a self-hosted customer
    When the organization and its first team are committed
    Then organization records "lw.organization.created" carrying the organization's id and name
    And peers such as prompt seed their own defaults from that fact

  @unit
  Scenario: The organization presence step records every organization a page at a time
    Given three organizations with stored presence settings, served two to a page
    When the organization presence upgrade step runs
    Then each organization's stored setting is recorded once
    And the step saves its checkpoint after each page, naming the page's last organization

  @unit
  Scenario: The organization presence step resumes after the last page it saved
    Given the organization presence upgrade step's checkpoint names the second organization
    When the step runs again
    Then only the organizations after the second are recorded

  @unit
  Scenario: A dry run of the organization presence step records nothing and saves no checkpoint
    Given three organizations with stored presence settings
    When the organization presence upgrade step runs as a dry run
    Then no setting is recorded and no checkpoint is saved
    And the report counts the organizations it would visit

  @integration
  Scenario: The organization presence step is a background step that waits for old writers to go
    When the worker's installed modules list their upgrade steps
    Then organization:record-presence-settings is a background data step
    And it runs only once no older image serves

  @unit
  Scenario: A peer's member fact reaches organization with the fact's own moment
    Given authz records a proven offboarding, or user records an erasure naming the organisations it sat in
    When organization hears the fact from its own side
    Then it records the member removal for each organisation named, keyed on the fact's occurredAt
    And an erasure records nobody as the remover, so a redelivered fact records nothing new

  @unit
  Scenario: A member fact for a deleted organisation records nothing
    Given an organisation was deleted before a proven offboarding or an erasure naming it arrived
    When organization hears the fact from its own side
    Then it records no member removal for the deleted organisation
    And it still records the removal for every live organisation the fact names
