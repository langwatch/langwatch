Feature: CLI families for webhooks and spend events
  Everything the webhook platform and the gateway spend pull surface expose
  over REST is operable from the langwatch CLI with an ORGANIZATION API key,
  so a billing engineer or a coding agent runs the whole lifecycle without a
  browser: endpoints, secrets, deliveries, health, the spend record, and
  per-end-user rollups.

  Rule: The families cover the REST surface and are discoverable

    @unit
    Scenario: The webhooks family lists every endpoint lifecycle command
      When the command catalog is built
      Then the webhooks family carries list, get, create, update, enable, disable, delete, roll-secret, test, deliveries, health, event-types, and events
      And every command is covered by the feature map

    @unit
    Scenario: The spend-events family covers pull and rollup
      When the command catalog is built
      Then the spend-events family carries list and by-user
      And every command is covered by the feature map

  Rule: Org-key auth is explicit

    @unit
    Scenario: Org-anchored commands resolve the organization API key
      Given LANGWATCH_ORG_API_KEY is set
      When an org-anchored command resolves its credentials
      Then the organization key wins over the project key
      And with neither set the command exits naming LANGWATCH_ORG_API_KEY

  Rule: Instant flags accept human and machine forms

    @unit
    Scenario: From and to flags parse ISO-8601 and epoch milliseconds
      When a range flag is parsed
      Then ISO-8601 instants and positive epoch milliseconds both resolve
      And garbage resolves to nothing so the command can refuse it
