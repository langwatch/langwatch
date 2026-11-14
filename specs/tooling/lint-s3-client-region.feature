Feature: The s3-client-region lint rule
  Each S3 client builder once chose its region by its own rule, and one of them
  sent "auto" to AWS (R2 in the dataset storage rollout ledger). An
  `new S3Client({ region })` outside `packages/aws-client` must take its region
  from that package's region rule, never from a literal or a hand-written check.

  @unit
  Scenario: A literal region on an S3 client is reported
    Given a module file that builds new S3Client({ region: "auto" })
    When the s3-client-region rule runs over it
    Then it reports the region property

  @unit
  Scenario: An S3 client with no region is reported
    Given a module file that builds new S3Client({ endpoint }) with no region
    When the s3-client-region rule runs over it
    Then it reports the client

  @unit
  Scenario: An S3 client with a region on only one path is reported
    Given a module file that builds new S3Client({ ...(enabled ? { region: s3RegionOf(config) } : {}) })
    When the s3-client-region rule runs over it
    Then it reports the client, since the other path names no region

  @unit
  Scenario: An S3 client whose options the rule cannot read is reported
    Given a module file that builds new S3Client(options) from a function parameter
    When the s3-client-region rule runs over it
    Then it reports the options, since their region cannot be seen

  @unit
  Scenario: A region is judged by the binding in scope, not by its name
    Given one function binds const region = s3RegionOf(config) and another binds const region = "auto"
    When the s3-client-region rule runs over both clients
    Then it reports only the client whose region binding is the literal

  @unit
  Scenario: A region from the shared rule is accepted
    Given a module file that builds new S3Client({ region: s3RegionOf({ region, endpoint }) })
    When the s3-client-region rule runs over it
    Then it reports nothing

  @unit
  Scenario: The AWS client package may build its own clients
    Given packages/aws-client building new S3Client({ region })
    When the s3-client-region rule runs over it
    Then it reports nothing
