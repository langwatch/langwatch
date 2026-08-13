Feature: Webhook settings and the billing events ledger
  The operator screens over the webhook platform and the spend-events
  table. AI Gateway > Webhooks edits endpoint subscriptions from the
  event registry and keeps signing secrets one-shot; the sibling
  Billing Events page renders the per-request ledger newest-first with
  keyset pagination. Both talk to session tRPC routers that mirror the
  REST surface's RBAC scopes and enterprise plan gate.

  Rule: Subscriptions are edited from the registry, never free-typed

    @integration
    Scenario: Event checkboxes render grouped by family from the registry
      When the endpoint drawer opens
      Then every registry type appears under its family group

    @integration
    Scenario: The family wildcard locks its children and saves as the wildcard selector
      Given the gateway family wildcard is checked
      Then the individual gateway type checkboxes are locked
      And saving submits the family wildcard instead of exact types

    @integration
    Scenario: Types without a producer yet are labeled in the drawer
      Then a type marked not emitting carries a visible label

    @integration
    Scenario: Saving requires a URL and at least one selected event
      Given an empty URL and no selected events
      Then the save action is disabled

  Rule: The drawer asks for the destination before it asks for its address

    @integration
    Scenario: The destination kind is a choice, and each kind asks for its own fields
      Given the endpoint drawer is open for a new endpoint
      Then the destination choice offers HTTP and Amazon SQS
      And choosing HTTP asks for a URL
      And choosing Amazon SQS asks for a queue URL instead

    @integration
    Scenario: An existing endpoint cannot be moved to another destination kind
      Given the drawer is open for an endpoint that already exists
      Then the destination choice is disabled
      And it explains that a new endpoint is how you change destination

    @integration
    Scenario: A queue endpoint saves only once its queue URL is filled in
      Given the drawer is open with Amazon SQS chosen and events selected
      Then the save action is disabled until a queue URL is entered

    @integration
    Scenario: The list says where each endpoint delivers
      Given endpoints of both kinds
      Then each row carries a badge naming its destination
      And a queue row shows the queue rather than an empty URL

  Rule: Signing secrets stay one-shot in the UI

    @integration
    Scenario: The signing secret dialog warns it is shown only once
      When a secret is revealed after create or roll
      Then the dialog shows the secret with the shown-once warning

    @unit
    Scenario: The session surface returns the secret only from create and roll mutations
      Then the create response carries the secret
      And no read procedure response contains secret material

  Rule: The session surface mirrors the REST surface's access control

    @unit
    Scenario: Read procedures require the view scope and mutations the manage scope
      Then list and eventTypes check webhookEndpoints view
      And mutations check webhookEndpoints manage

    @unit
    Scenario: A denied scope rejects before any service call
      Given a member without the manage scope
      Then create is rejected and nothing is persisted

    @unit
    Scenario: Sessions of organizations without the plan flag are refused
      Given an active plan without webhookEndpoints
      Then every procedure refuses with the enterprise message

    @unit
    Scenario: Unknown event selectors surface as a bad request in the session surface
      When create is called with a selector the registry does not know
      Then the mutation fails as a bad request

  Rule: The billing events ledger is a faithful read of the spend table

    @integration
    Scenario: Ledger rows show token classes, cost, provider, and link to the trace
      Then a row renders its token class summary, rated cost, provider, and a trace drill-through

    @integration
    Scenario: Changing a ledger filter resets pagination
      When an equality filter changes
      Then the query restarts from the first page

    @integration
    Scenario: A next cursor is the only thing that offers load more
      Then load more renders exactly when the page returned a next cursor

    @integration
    Scenario: The ledger explains itself when ClickHouse is disabled
      Then the page states that billing events need ClickHouse

    @unit
    Scenario: Ledger filters and cursor pass through to the repository page read
      Then the repository receives the same filters, cursor, and limit

    @unit
    Scenario: Ledger rows resolve virtual key display names
      Then the response maps virtual key ids to their names

    @unit
    Scenario: The ledger requires the gateway usage view scope
      Given a member without gateway usage view
      Then the list query is rejected before any read

    @unit
    Scenario: The ledger degrades to an empty page without ClickHouse
      Then the query returns an empty page flagged clickHouseDisabled
