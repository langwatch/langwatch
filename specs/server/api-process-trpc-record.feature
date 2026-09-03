Feature: The API process mounts one tRPC record from its own collaborators

  Every browser call the product makes arrives on one tRPC root. The process
  builds that root from a record of named namespaces, each filled by the half
  of the composition that owns it, and mounts the record only once every entry
  is filled.

  The failure this shape exists to prevent is a half-built root that still
  serves: a namespace nobody filled would answer as though the feature were
  absent rather than as though the deployment were misconfigured, and the
  difference is invisible from the browser.

  Rule: The record is complete or it is not mounted

    @integration
    Scenario: A complete collaborator set mounts the whole record
      Given every half of the composition has filled the entries it owns
      When the process builds its tRPC record
      Then the record carries exactly the namespaces it declares, with no absence

    @integration
    Scenario: An incomplete collaborator set composes no record and names the gap
      Given a half left the entries it owns unfilled
      When the process builds its tRPC record
      Then the set is sealed as incomplete rather than mounted
      And every missing entry is named

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

  Rule: A capability the deployment did not compose refuses rather than answering

    @integration
    Scenario: A capability the deployment does not hold refuses by name
      Given a deployment that composed no such capability
      When a surface that needs it is called
      Then the refusal carries the unavailable-service code rather than an empty answer
