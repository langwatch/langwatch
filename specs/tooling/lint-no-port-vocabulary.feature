Feature: The no-port-vocabulary lint rule
  "Port" names no layer this architecture has: state a module owns is a
  repository, an exchange with something it does not own is a channel, and
  behaviour is a service. The rule refuses a PascalCase `*Port` name and a
  `ports/` path, and leaves a network port and words that merely contain
  "port" alone.

  @unit
  Scenario: A declared or imported name ending in Port is reported
    Given a module source file that declares an interface or class, or imports a name, ending in Port
    When the no-port-vocabulary rule runs over it
    Then it reports portVocabulary naming the identifier

  @unit
  Scenario: A re-export from a ports folder is reported
    Given a module source file that re-exports from a ports folder
    When the no-port-vocabulary rule runs over it
    Then it reports portVocabulary naming the specifier

  @unit
  Scenario: A file living under a ports folder is reported
    Given a module source file whose path runs through a ports folder
    When the no-port-vocabulary rule runs over it
    Then it reports portFile

  @unit
  Scenario: A network port and words containing port are left alone
    Given source naming a lower camel case port, transport, report, support, import or export
    When the no-port-vocabulary rule runs over it
    Then it reports nothing
