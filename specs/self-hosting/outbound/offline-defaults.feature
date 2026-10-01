Feature: A self-hosted install makes no third-party call it was not asked to make
  As the operator of a self-hosted install under a security review
  I want the third-party calls libraries inside the images would make to be off by default
  So that the egress list a reviewer reads is the egress the install makes

  @unit
  Scenario: A default chart render switches off the third-party calls libraries would make
    Given the langwatch chart rendered with default values
    When the app, workers and langevals workloads are read
    Then each lists the offline defaults ConfigMap first in envFrom
    And the ConfigMap disables Prisma's checkpoint, the voice quick tunnel and RAGAS analytics
    And no workload sets those variables in env, where they would outrank the operator's envFrom

  @unit
  Scenario: An operator's own value replaces an offline default
    Given the operator names one of the variables in extraEnvs, or adds an extraEnvFrom source
    When the chart is rendered
    Then the operator's env entry is carried once
    And the operator's envFrom source comes after the offline defaults, so it wins

  @unit
  Scenario: Token counting reads the tokenizer files the image ships
    Given TIKTOKENS_PATH points at a directory holding the encoding file
    When a span's tokens are counted
    Then the file is read from that directory and no network request is made

  @unit
  Scenario: Prisma's version check is off in every environment
    Given CHECKPOINT_DISABLE is empty, which would leave the check on
    When any prisma command loads the app's Prisma config
    Then CHECKPOINT_DISABLE is "1" and the check is skipped
