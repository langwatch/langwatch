Feature: Topic clustering runs in Go with the Python results
  As someone who groups their traces into topics
  I want the Go topic clustering to form the same topics as the Python service
  So that moving clustering off Python does not reshuffle my topics

  # Design: dev/docs/plans/langevals-go/topic-clustering-go.md. Numerics are
  # compared with scipy 1.17.1 / numpy 1.26.4 on recorded fixtures; naming is
  # random in Python, so it is compared as a call plan, not as text. Python
  # stays the production path until the TS engine switch selects Go.

  # ============================================================================
  # Numerics
  # ============================================================================

  @unit
  Scenario: Ward linkage reproduces scipy's merge order, heights and cluster ids
    Given embeddings recorded with scipy's linkage matrix
    When Go computes the Ward linkage
    Then every merge joins the same cluster ids with the same size
    And every height is within 1e-12 of scipy's

  @unit
  Scenario: Flat clusters at distance 4 and 2 match scipy's labels
    Given a recorded linkage matrix
    When Go cuts it at distance 4 and at distance 2
    Then every trace carries scipy's cluster label at both distances

  @unit
  Scenario: Centroids and p95 distances match numpy
    Given a recorded flat cluster
    When Go computes its centroid and the 95th percentile of cosine distances
    Then both are within 1e-12 of numpy's

  @unit
  Scenario: A cluster with too few distinct inputs, a p95 over the ceiling or no surviving subtopic is dropped
    Given clusters with fewer than 5 distinct inputs, and clusters looser than the p95 ceiling
    When the topic hierarchy is built
    Then the same topics and subtopics survive as in Python
    And the traces of a dropped cluster are not returned

  # ============================================================================
  # Embeddings
  # ============================================================================

  @unit
  Scenario: Whitespace-only inputs are neither embedded nor returned
    Given traces whose input is empty or whitespace only
    When they are clustered
    Then they are not sent for embedding
    And they appear in no answer row

  @unit
  Scenario: Embeddings are padded or truncated to 1,536 dimensions
    Given a provider that answers shorter or longer vectors
    When they are normalized
    Then each vector has 1,536 dimensions, zero-padded or truncated

  @integration
  Scenario: A failed embedding batch falls back to one call per text
    Given an embedding batch that fails
    When the traces are embedded
    Then every text is embedded again with one call each
    And a text that fails twice or less drops only its trace

  @integration
  Scenario: A third failed text fails the clustering
    Given an embedding batch that fails and three texts that fail on their own
    When the traces are embedded
    Then the clustering answers topic_clustering_failed

  @integration
  Scenario: Missing embedding credentials fail at once without a per-text retry
    Given a tenant without credentials for the embedding model
    When the traces are embedded
    Then the clustering answers topic_clustering_failed after one batch call

  @integration
  Scenario: Embedding cost is counted only when embedding pricing is switched on
    Given embedding calls that report a price
    When clustering runs with embedding pricing off, then on
    Then the reported cost leaves embeddings out, then includes them

  # ============================================================================
  # Incremental clustering
  # ============================================================================

  @unit
  Scenario: A trace joins the nearest topic within 1.1 times its p95, else stays unassigned
    Given existing topics with centroids and p95 distances
    When a trace is assigned
    Then it joins the nearest topic when within 1.1 times that topic's p95
    And the first topic wins a tie
    And with no topics it stays unassigned

  @unit
  Scenario: More than 100 unassigned traces create new topics bounded by the mean existing p95
    Given 101 traces that match no existing topic
    When incremental clustering runs
    Then new topics are formed from them with the mean existing p95 as ceiling

  @integration
  Scenario: 100 or fewer unassigned traces are left out of the answer
    Given 100 traces that match no existing topic
    When incremental clustering runs
    Then no topic is created
    And no answer row has a null topic

  @integration
  Scenario: New subtopics are created under the topic their traces matched
    Given at least 50 traces that matched an existing topic but none of its subtopics
    When incremental clustering runs
    Then the new subtopics have that topic as parent
    And their traces carry that topic's id, never a topic that was not created

  @integration
  Scenario: A trace appears once even when its topic gains new subtopics
    Given traces that matched a topic only and then formed a new subtopic under it
    When incremental clustering answers
    Then each trace has exactly one row, the one with its new subtopic

  @integration
  Scenario: Batch and incremental membership match the Python recording
    Given the Python service's recorded answers for a batch and two incremental pages
    When Go clusters the same traces with the same scripted models
    Then the same topics and subtopics are created
    And every trace lands in the same topic and subtopic

  # ============================================================================
  # Naming
  # ============================================================================

  @unit
  Scenario: The naming prompts match Python byte for byte
    Given the prompts recorded from topic_naming.py
    When Go renders the naming, existing-names and pair prompts
    Then each is identical to Python's

  @unit
  Scenario: Names are asked in batches of at most 150 samples with the existing names
    Given topics whose samples add up to more than 150
    When their names are asked
    Then each call holds at most the split size of samples
    And the system prompt lists the existing names

  @integration
  Scenario: A missing name is retried, then the topic is dropped
    Given a naming answer without a name for one topic
    When names are asked
    Then the call is retried up to 4 times
    And the topics of that call get no name and are not created

  @integration
  Scenario: Similar names are disambiguated at most three times
    Given names whose embeddings are within cosine distance 0.6
    When names are improved
    Then the closest pair is renamed, at most three times

  @integration
  Scenario: The cost is the sum of the naming calls in USD
    Given naming calls that each report a price
    When clustering answers
    Then the cost is their sum in USD

  @integration
  Scenario: An unpriced chat model still names topics at zero cost
    Given a chat model without a known price
    When topics are named
    Then the topics are created with a cost of zero

  # ============================================================================
  # Transport
  # ============================================================================

  @integration
  Scenario: A body over the clustering cap is refused with 413
    Given a clustering body larger than the cap
    When it is posted
    Then the answer is 413 evaluation_payload_too_large

  @integration @unimplemented
  Scenario: A staged body is fetched from its presigned URL
    Given a clustering body staged in object storage
    When its presigned URL is posted
    Then the staged body is fetched and clustered

  @integration
  Scenario: Fewer than 2 usable traces answers topic_clustering_too_few_traces
    Given a batch with one usable trace
    When it is posted
    Then the answer is 422 topic_clustering_too_few_traces

  @integration
  Scenario: Clustering past its deadline stops provider calls and answers an error
    Given a provider that does not answer before the clustering deadline
    When clustering runs
    Then the provider call is cancelled
    And the clustering answers topic_clustering_failed
