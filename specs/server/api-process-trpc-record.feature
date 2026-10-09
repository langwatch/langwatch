Feature: The API process mounts one tRPC record from its own collaborators

  Every browser call the product makes arrives on one tRPC root. The process
  builds that root from a record of named namespaces, each filled by the
  feature that owns it, over the one application every namespace reads, and
  mounts the record only once it holds that application.

  The failure this shape exists to prevent is a half-built root that still
  serves: a namespace nobody filled would answer as though the feature were
  absent rather than as though the deployment were misconfigured, and the
  difference is invisible from the browser.

  Rule: The record is complete or it is not mounted

    @integration
    Scenario: A complete collaborator set mounts the whole record
      Given every feature has composed the application slice it owns
      When the process builds its tRPC record
      Then the record carries exactly the namespaces it declares, with no absence

    @unit
    Scenario: A process missing a module the record needs refuses to boot by name
      Given a process installs a module whose namespace needs another module's Api
      And the process does not install the module that provides it
      When the process boots
      Then the boot is refused naming the module and the missing peer
      And no record is mounted

  Rule: The record answers on the root the process actually serves

    @integration
    Scenario: A subscription in the record is watchable on the same root
      Given a client watches a long-running export
      When it opens the subscription path on the process's own server-sent-events lane
      Then the stream connects, carries the published event, and completes
      And the path resolves against the same root the request endpoint serves

    @integration
    Scenario: A new organization is created with its first team
      Given a signed-in person with no organization
      When the sign-up ceremony runs through the process's own tRPC handler
      Then the organization, its founding membership and its first team are written in that order
      And the founder's organization and team administration grants follow those rows

    @integration
    Scenario: The data privacy snapshot is filtered by what the caller may read
      Given a project whose privacy rules are set at more than one scope
      When the privacy settings page reads its snapshot through the process's own root
      Then the whole scope cascade is resolved and every rule is named from the directory
      And only the scopes the caller may write are offered as choices

    @integration
    Scenario: An id no trace answers to is never queued for review
      Given a request naming trace ids, only some of which trace storage answers to
      When the ids are queued for annotation through the process's own root
      Then only the ids storage answered to become queue items

  Rule: A module the deployment did not install refuses the boot rather than answering

    @unit
    Scenario: A deployment that did not install a needed module refuses to boot by name
      Given a deployment that installs a module needing a peer module it did not install
      When the process boots
      Then the boot is refused naming the missing module
      And nothing is constructed, so no surface answers with an empty result
