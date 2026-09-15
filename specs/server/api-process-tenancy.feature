Feature: The standalone API process composes the services its routes address
  As an operator running a LangWatch API deployment
  I want the API process to build the organization, project and API-key
  services it resolves credentials and scopes against
  So that serving product traffic does not require a second process to hand it
  a credential graph

  # WHY THIS EXISTS
  #
  # `API_UNAVAILABLE_PRODUCT_ADAPTERS` named `ApiKeyBindingIdPort`,
  # `ApiKeyDiagnosticsPort` and the organization identity ports. By the time
  # this entry closed, none of those was the legacy application's any more:
  # each mints a PERSISTED format — a ksuid with its exact prefix, a slug
  # derived through an exact pre-pass, `sk-lw-` plus 48 characters of a 54-byte
  # alphabet — and formats belong to the feature that promises them, not to
  # whichever process composes it.
  #
  # What actually kept the entry open was underneath them: the three services
  # are built from an AuthZ service AND its grants half, which no process
  # outside the legacy application could compose. That changed. The remaining
  # two collaborators are genuinely a process's own, because they resolve from
  # its environment: the cipher an organization's settings are stored under,
  # and the pepper an API key's stored hash is derived under.

  Rule: The three services are one graph or none

    @unit
    Scenario: The API process composes its own organization and API-key services
      Given the deployment configured a database, a stored-secret key and an
      API-key pepper
      And the process composed its own AuthZ services
      When it composes
      Then it builds the organization, project and API-key services together
      And it mounts the API-key family over the services it built

    @unit
    Scenario: Half a credential graph is refused at boot
      Given a host supplies one of the API-key and organization services
      When the composition is created
      Then it is refused before any resource is opened
      # The API-key service reads the project service, which resolves through
      # the organization service. Composing the missing half here would give
      # this process an API-key service whose organizations are not the
      # organizations its own routes resolve.

  Rule: A host that owns the graph owns the pair

    @unit
    Scenario: An injected pair is the one the process serves
      Given a host supplies both the API-key and organization services
      When the process composes
      Then those are the services its routes resolve against
      And the process composes none of its own

  Rule: A credential this process cannot verify is not a weaker service

    @unit
    Scenario: A process missing any of the four composes no credential services
      Given the process is missing its database, its AuthZ, or its pepper
      When it tries to compose the credential services
      Then it composes none, and names what was missing at boot

    @unit
    Scenario: A process that can compose no credential services mounts no product transports
      Given the process composed AuthZ but was configured with no API-key pepper
      When it composes
      Then it serves its lifecycle surface and mounts no product transports
      # Every product route on this process resolves a credential. A door open
      # over a pepper this deployment does not have would authenticate none of
      # the keys a customer already holds, and would say so one request at a
      # time instead of once at boot.

  Rule: A persisted format is read the way the other tier writes it

    @unit
    Scenario: The API-key pepper reaches the service verbatim
      Given the deployment configured an API-key pepper
      When the API-key service is composed
      Then it receives the configured value itself, not anything derived from it
      # It is an HMAC key over a persisted hash. A process that peppered with
      # the cipher's decoded bytes would hash every presented credential
      # differently and authenticate none of the keys already issued.

    @unit
    Scenario: Organization settings are encrypted by the process's one cipher
      Given the process composed the cipher its stored secrets run under
      When an organization setting is written and read back
      Then it is the same cipher on both sides
      # Two ciphers over one key is how two descriptions of one at-rest format
      # start to drift.
