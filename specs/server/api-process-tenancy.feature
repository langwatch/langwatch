Feature: The API process serves credentials through the installed tenancy modules
  As an operator running a LangWatch API deployment
  I want the credential services to be the installed modules' own
  So that a presented key resolves through the organization and project it belongs to

  # The organization, project and API-key modules declare each other as peers
  # (project reads organization, api-key reads project); a process installing
  # one without the module it reads refuses to boot, naming both (see
  # declarative-process-composition.feature). No host hands the process a half
  # of that graph, so a half graph cannot be offered.

  Rule: A credential this process cannot verify is not a weaker service

    @unit
    Scenario: A process configured with no API-key pepper refuses to boot, naming the setting
      Given the process installs the API-key module
      And the deployment set none of API_KEY_PEPPER, CREDENTIALS_SECRET and NEXTAUTH_SECRET
      When the process boots
      Then the boot refuses, naming the pepper settings it looked for
      # Main's chain: the first of the three that is set is the pepper; an
      # empty value counts as unset, and a key is never hashed under "".

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
