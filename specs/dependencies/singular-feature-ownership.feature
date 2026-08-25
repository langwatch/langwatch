# See ../../dev/docs/adr/112-singular-feature-ownership.md
# Package surface and source-layout mechanics remain owned by
# ../../packages/architecture-lint/specs/feature-package-boundaries.feature and
# ../../packages/architecture-lint/specs/strict-feature-layout.feature.
# Physical executable extraction remains owned by
# application-workspace-boundaries.feature.
# Enterprise catalogue membership remains owned by
# ../../packages/enterprise/specs/enterprise-catalogue.feature.

@unimplemented
Feature: Singular feature ownership
  As a platform maintainer
  I want each product domain to have one singular feature and service boundary
  So that moving the application into packages does not duplicate behaviour or create catch-all packages

  Rule: Durable product domains have separate singular owners

    @architecture @catalogue
    Scenario Outline: Primary product domains remain separate features
      Given the product domain <domain>
      When the feature catalogue is inspected
      Then <domain> has the singular feature root <root>
      And no broader feature claims <domain> as a local subject

      Examples:
        | domain         | root                              |
        | user           | packages/features/user           |
        | organization   | packages/features/organization   |
        | project        | packages/features/project        |
        | role           | packages/features/role           |
        | auth           | packages/features/auth           |
        | authz          | packages/features/authz          |
        | api-key        | packages/features/api-key        |
        | dashboard      | packages/features/dashboard      |
        | data-privacy   | packages/features/data-privacy   |
        | github         | packages/features/github         |
        | model-provider | packages/features/model-provider |
        | presence       | packages/features/presence       |
        | prompt         | packages/features/prompt         |
        | dataset        | packages/features/dataset        |
        | topic          | packages/features/topic          |

    @architecture @naming
    Scenario: Feature roots and package names use the singular catalogue identifier
      Given a governed feature is registered in the ownership catalogue
      When architecture lint inspects its root and surface manifests
      Then the feature directory equals its singular identifier
      And contract, server, and web package names derive from that identifier
      And a plural alias is not accepted as a second feature root

    @architecture @granularity
    Scenario: A subordinate endpoint remains with its product owner
      Given user profile and user avatar have separate compatibility URLs
      When their implementation ownership is inspected
      Then both delegate to the canonical User service
      And no avatar service package or caller-owned user repository exists

    @architecture @granularity
    Scenario: Related independently useful domains do not collapse into a theme
      Given a use case combines a project, API key, model provider, prompt, and dataset
      When its dependencies are inspected
      Then each durable domain retains its own feature service contract
      And the use case composes those contracts without creating an AI configuration feature

    @architecture @granularity
    Scenario: Analytical products do not collapse into the query engine
      Given Dashboard owns dashboards, graphs, saved workbench charts, and ordering
      And Topic owns topic models and clustering runs
      When those features need analytical data
      Then they consume the canonical Analytics service
      And Analytics does not own their durable lifecycle

    @architecture @granularity
    Scenario: Shared GitHub lifecycle does not belong to one consumer
      Given Coding Agent and Langy both use GitHub installations and pull-request linkage
      When their dependencies are inspected
      Then GitHub owns the installation, webhook, repository, and pull-request lifecycle
      And Coding Agent and Langy consume the canonical GitHub service

  Rule: The catalogue makes ownership expansion explicit

    @unit @architecture
    Scenario: Every production subject has exactly one owner
      Given packages/features/catalogue.json declares core and Enterprise subjects
      When architecture lint checks governed feature source
      Then every production module subject resolves to exactly one registered feature
      And duplicate or unowned subjects fail with their source path

    @unit @architecture
    Scenario: A local manifest cannot broaden a feature
      Given Governance source introduces a project service or project repository
      When architecture lint checks the source and catalogue
      Then it reports that project belongs to the Project feature
      And adding project to Governance feature.json does not suppress the violation

    @unit @architecture
    Scenario: A new durable domain changes its architecture records
      Given a maintainer adds a new feature or owned subject to the catalogue
      When architecture lint checks the repository
      Then the owning feature root has a linked boundary ADR and Gherkin specification
      And an undocumented catalogue expansion fails the gate

  Rule: Features collaborate through one canonical service

    @architecture @typecheck
    Scenario: A feature consumes another feature through its contract
      Given Governance needs project information
      When Governance production dependencies are inspected
      Then it receives the Project service from @langwatch/project-contract
      And it imports no Project repository, Project server implementation, or generated Project persistence type
      And it declares no GovernanceProjectService

    @architecture @service
    Scenario: Public cross-feature capability is a service contract
      Given a feature has a contract, server implementation, and private persistence
      When another feature consumes it
      Then the consumer imports the abstract service and portable Zod 4 values from the contract root
      And repository, store, projection, adapter, and provider ports remain private
      And the concrete service is a class composed once by the runtime

  Rule: Core and Enterprise ownership remain truthful

    @architecture @licensing
    Scenario: SaaS remains inside the Enterprise source-license boundary
      Given SaaS deployment integrations contain Enterprise-licensed vendor integration source
      When package ownership and the Enterprise catalogue are inspected
      Then SaaS lives at packages/enterprise/features/saas
      And its packages use the @langwatch/enterprise-saas prefix
      And the Enterprise catalogue contains saas
      And deployment-mode activation is not described as an Enterprise entitlement gate

    @architecture @ops
    Scenario: Platform administration belongs to core Ops
      Given backoffice administration and operational tooling are available to every installation
      When their implementation ownership is inspected
      Then both live in packages/features/ops
      And Ops owns admin access, impersonation, queues, replay, schedulers, and event and process operations
      And no packages/enterprise/features/admin root remains
      And existing admin routes may remain thin compatibility transports

    @architecture @governance
    Scenario: Governance owns governance behaviour only
      Given Governance needs user, project, personal-workspace, virtual-key, or model-provider behaviour
      When its service graph is composed
      Then those behaviours come from their core owning service contracts
      And Governance retains only ingestion, OTTL policy, anomaly, attribution, quarantine, and governance-delivery behaviour

  Rule: Ownership migration preserves compatibility

    @integration @api
    Scenario: Existing API paths survive a feature move
      Given a REST, RPC, or tRPC endpoint is moved behind a feature service
      When an existing client calls its current path with the current payload
      Then the compatibility adapter delegates to the canonical service
      And the response and handled-error contract remain compatible

    @architecture @migration
    Scenario: Feature extraction remains vertical and incremental
      Given the monolith still owns unextracted behaviour
      When one catalogue feature is migrated
      Then its contract, server, optional web, tests, ADR, spec, and runtime wiring move together
      And the still-runnable application consumes the new package
      And no second implementation or permanent forwarding package is introduced
      And deployment images and commands remain unchanged
