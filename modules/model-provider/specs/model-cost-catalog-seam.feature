Feature: A project's own cost rules compose without the provider write graph
  Record-time enrichment prices each LLM call against the rates the customer
  stored, and those rates are scoped to the project, its team and its
  organization. Reaching them through the model provider service meant composing
  nine collaborators — an organization service, an authorization service, a
  provider catalog, a translation port, an id service, a credential codec, a
  Codex token refresher and a connection rate limiter — because writing a cost
  authorizes a scope and every credential path decrypts a key. Listing them asks
  none of those anything: the scopes come off the project's own row, and the
  reader is already inside the tenant whose rules it is reading.

  Rule: The catalogue composes from a database and one project read

    @unit
    Scenario: The cost catalogue composes from a database and one project read
      Given a Prisma client and a project read with its team
      When the cost catalogue is composed and a project's costs are listed
      Then the rules stored under the project, team and organization scopes are read

    @unit
    Scenario: A project that cannot be read prices nothing rather than failing
      Given a project that no longer resolves
      When its costs are listed
      Then the list is empty and no cost row is read
