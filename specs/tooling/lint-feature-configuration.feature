Feature: The feature-configuration architecture policy
  A module's configuration is declared once, in its contract's `<name>.config.ts`,
  as one `Config.define` whose `c.env` leaves name the environment variables
  (ARCHITECTURE.md §6). The policy refuses a declaration anywhere else in the
  module and the deleted `*ServerConfigSchema`/`*AppConfigSchema` exports
  (§15). One owner per environment variable is boot's `config_collision`, and
  `static readonly configSchema` is counted by `deleted-spellings-in-code`.

  Rule: `feature-configuration` keeps a module's configuration in its contract config module

    @unit
    Scenario: A module declaring its configuration in its contract config module passes
      Given a module whose contract config module holds one Config.define and a web projection schema
      When the feature-configuration policy runs
      Then it reports nothing
      And it does not ask for a ServerConfigSchema or WebConfigSchema export

    @unit
    Scenario: Config.define outside the contract config module is refused
      Given a module whose process half calls Config.define in a service
      When the feature-configuration policy runs
      Then it reports that file
      And the fix names the module's contract config module

    @unit
    Scenario: A deleted config schema spelling is refused
      Given a module's contract config module exporting a ServerConfigSchema or AppConfigSchema const
      When the feature-configuration policy runs
      Then it reports the spelling as deleted by section 15

    @unit
    Scenario: Test files and two modules binding one variable are left to their own checks
      Given a test file calling Config.define
      And two modules whose config modules both bind one environment variable
      When the feature-configuration policy runs
      Then it reports nothing, since boot refuses the second claim by name
