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
  Scenario: A region from the shared rule is accepted
    Given a module file that builds new S3Client({ region: s3RegionOf({ region, endpoint }) })
    When the s3-client-region rule runs over it
    Then it reports nothing

  @unit
  Scenario: The AWS client package may build its own clients
    Given packages/aws-client building new S3Client({ region })
    When the s3-client-region rule runs over it
    Then it reports nothing
