@integration
Feature: Recent Items Backend
  As a user
  I want to retrieve my recently accessed items
  So that I can quickly jump back to what I was working on

  Background:
    Given I am authenticated as user "user-123"
    And I have access to project "project-456"

  # Empty state
  Scenario: Returns empty array when user has no recent activity
    Given I have no audit log entries
    When I request recent items with limit 12
    Then I should receive an empty array

  # Filtering
  Scenario: Returns items from AuditLog filtered by user and project
    Given user "other-user" has audit log entries for project "project-456"
    And I have audit log entries for project "other-project"
    And I have audit log entries for project "project-456"
    When I request recent items with limit 12
    Then I should only receive items from my audit log entries for project "project-456"

  # Entity extraction - Prompts
  Scenario: Extracts prompt IDs from prompts.update actions
    Given I have an audit log entry for action "prompts.update" with args:
      | configId | prompt-123 |
    And a prompt exists with id "prompt-123" and name "My Prompt"
    When I request recent items with limit 12
    Then I should receive an item with:
      | type | prompt       |
      | id   | prompt-123   |
      | name | My Prompt    |

  Scenario: Extracts prompt IDs from prompts.create actions
    Given I have an audit log entry for action "prompts.create" with args:
      | configId | prompt-456 |
    And a prompt exists with id "prompt-456" and name "New Prompt"
    When I request recent items with limit 12
    Then I should receive an item with:
      | type | prompt       |
      | id   | prompt-456   |
      | name | New Prompt   |

  # Entity extraction - Workflows
  Scenario: Extracts workflow IDs from workflow.update actions
    Given I have an audit log entry for action "workflow.update" with args:
      | workflowId | workflow-123 |
    And a workflow exists with id "workflow-123" and name "My Workflow" and icon "🔄"
    When I request recent items with limit 12
    Then I should receive an item with:
      | type | workflow     |
      | id   | workflow-123 |
      | name | My Workflow  |
      | icon | 🔄           |

  Scenario: Extracts workflow IDs from workflow.create actions
    Given I have an audit log entry for action "workflow.create" with args:
      | workflowId | workflow-456 |
    And a workflow exists with id "workflow-456" and name "New Workflow" and icon "⚡"
    When I request recent items with limit 12
    Then I should receive an item with:
      | type | workflow     |
      | id   | workflow-456 |
      | name | New Workflow |
      | icon | ⚡           |

  # Entity extraction - Datasets
  Scenario: Extracts dataset IDs from dataset.update actions
    Given I have an audit log entry for action "dataset.update" with args:
      | datasetId | dataset-123 |
    And a dataset exists with id "dataset-123" and name "My Dataset"
    When I request recent items with limit 12
    Then I should receive an item with:
      | type | dataset      |
      | id   | dataset-123  |
      | name | My Dataset   |

  Scenario: Extracts dataset IDs from dataset.create actions
    Given I have an audit log entry for action "dataset.create" with args:
      | datasetId | dataset-456 |
    And a dataset exists with id "dataset-456" and name "New Dataset"
    When I request recent items with limit 12
    Then I should receive an item with:
      | type | dataset      |
      | id   | dataset-456  |
      | name | New Dataset  |

  # Entity extraction - Evaluations (Monitors)
  Scenario: Extracts evaluation IDs from monitors.update actions
    Given I have an audit log entry for action "monitors.update" with args:
      | checkId | monitor-123 |
    And a monitor exists with id "monitor-123" and name "My Evaluation"
    When I request recent items with limit 12
    Then I should receive an item with:
      | type | evaluation    |
      | id   | monitor-123   |
      | name | My Evaluation |

  # Entity extraction - Annotation Queues
  Scenario: Extracts annotation queue IDs from annotation.createQueue actions
    Given I have an audit log entry for action "annotation.createQueue" with args:
      | annotationQueueId | queue-123 |
    And an annotation queue exists with id "queue-123" and name "My Queue"
    When I request recent items with limit 12
    Then I should receive an item with:
      | type | annotation |
      | id   | queue-123  |
      | name | My Queue   |

  # Hydration
  Scenario: Hydrates items with entity name and updatedAt
    Given I have an audit log entry for action "workflow.update" with args:
      | workflowId | workflow-789 |
    And a workflow exists with id "workflow-789" and name "Test Workflow" and icon "🧪" and updatedAt "2024-01-15T10:30:00Z"
    When I request recent items with limit 12
    Then I should receive an item with:
      | type      | workflow             |
      | name      | Test Workflow        |
      | icon      | 🧪                   |
      | updatedAt | 2024-01-15T10:30:00Z |

  # Deleted entities
  Scenario: Excludes deleted entities from results
    Given I have an audit log entry for action "prompts.update" with args:
      | configId | deleted-prompt |
    And no prompt exists with id "deleted-prompt"
    When I request recent items with limit 12
    Then I should not receive an item with id "deleted-prompt"

  Scenario: Excludes archived workflows from results
    Given I have an audit log entry for action "workflow.update" with args:
      | workflowId | archived-workflow |
    And a workflow exists with id "archived-workflow" and archivedAt "2024-01-01T00:00:00Z"
    When I request recent items with limit 12
    Then I should not receive an item with id "archived-workflow"

  # Limits and ordering
  Scenario: Limits results to requested count
    Given I have 20 audit log entries for different prompts
    When I request recent items with limit 5
    Then I should receive exactly 5 items

  Scenario: Orders by most recently touched first
    Given I have an audit log entry for action "prompts.update" at "2024-01-10T10:00:00Z" with args:
      | configId | old-prompt |
    And I have an audit log entry for action "prompts.update" at "2024-01-15T10:00:00Z" with args:
      | configId | new-prompt |
    And prompts exist for both ids
    When I request recent items with limit 12
    Then the first item should have id "new-prompt"
    And the second item should have id "old-prompt"

  # Deduplication
  Scenario: Deduplicates same entity touched multiple times
    Given I have an audit log entry for action "prompts.update" at "2024-01-10T10:00:00Z" with args:
      | configId | prompt-123 |
    And I have an audit log entry for action "prompts.update" at "2024-01-15T10:00:00Z" with args:
      | configId | prompt-123 |
    And a prompt exists with id "prompt-123" and name "My Prompt"
    When I request recent items with limit 12
    Then I should receive exactly 1 item with id "prompt-123"
    And its timestamp should reflect the most recent touch

  # Deep links
  Scenario: Returns correct deep link URL for prompts
    Given I have an audit log entry for action "prompts.update" with args:
      | configId | prompt-123 |
    And a prompt exists with id "prompt-123" and name "My Prompt"
    When I request recent items with limit 12
    Then the item should have href containing "/prompts" and "prompt-123"

  Scenario: Returns correct deep link URL for workflows
    Given I have an audit log entry for action "workflow.update" with args:
      | workflowId | workflow-123 |
    And a workflow exists with id "workflow-123" and name "My Workflow"
    When I request recent items with limit 12
    Then the item should have href "/project-456/studio/workflow-123"

  Scenario: Returns correct deep link URL for datasets
    Given I have an audit log entry for action "dataset.update" with args:
      | datasetId | dataset-123 |
    And a dataset exists with id "dataset-123" and name "My Dataset"
    When I request recent items with limit 12
    Then the item should have href "/project-456/datasets/dataset-123"

  Scenario: Returns correct deep link URL for evaluations
    Given I have an audit log entry for action "monitors.update" with args:
      | checkId | monitor-123 |
    And a monitor exists with id "monitor-123" and name "My Evaluation" and slug "my-evaluation"
    When I request recent items with limit 12
    Then the item should have href "/project-456/evaluations"

  Scenario: Returns correct deep link URL for annotation queues
    Given I have an audit log entry for action "annotation.createQueue" with args:
      | annotationQueueId | queue-123 |
    And an annotation queue exists with id "queue-123" and name "My Queue" and slug "my-queue"
    When I request recent items with limit 12
    Then the item should have href "/project-456/annotations/my-queue"
