Feature: Find traces like this one
  Topic clustering already embeds each trace's input through the project's embeddings model.
  Trace keeps those embeddings in ClickHouse and answers, for one trace, the traces of the
  same project nearest to it by cosine distance. No embedding call is made beyond the ones
  clustering makes. Decision: modules/trace/adrs/003-similar-traces-from-clustering-embeddings.md

  # Keeping the embeddings clustering computes

  @unit
  Scenario: Clustering hands back the embeddings it computed when asked
    Given a clustering request that sets return_trace_embeddings
    When langevals clusters the page in batch or incremental mode
    Then the response carries every embedded trace's vector, scaled to int8 and base64 encoded

  @unit
  Scenario: Clustering keeps its response under the deployment's ceiling
    Given a clustering request with return_trace_embeddings and a max_response_bytes
    When the embeddings would take the response past that ceiling
    Then langevals leaves out the embeddings that do not fit, in page order
    And it says how many it left out

  @unit
  Scenario: A caller that does not ask for embeddings gets the response it always had
    Given a clustering request without return_trace_embeddings
    When langevals clusters the page
    Then the response has no trace_embeddings field

  @unit
  Scenario: Topic clustering keeps the embeddings it already computed
    Given a project whose clustering run reads a page of traces
    When langevals answers with the page's embeddings
    Then the request asked langevals for them, under a 5 MiB response ceiling
    And trace is handed each embedding with the embeddings model and the time its trace happened

  @unit
  Scenario: An older langevals that returns no embeddings changes nothing
    Given a langevals that answers without trace_embeddings
    When a clustering page completes
    Then nothing is written to trace and the page reports the traces it processed

  @unit
  Scenario: Failing to keep embeddings never fails the clustering page
    Given trace refuses the embeddings write
    When a clustering page completes
    Then the page still reports its traces processed and no skip reason
    And clustering is not retried, so no embedding is paid for twice

  @unit
  Scenario: A kept embedding carries the project's trace retention
    When trace keeps an embedding for a project
    Then the row carries the project's retention for traces
    And the row is anchored on the time its trace happened, the column its TTL counts from

  @unit
  Scenario: An embedding that is not 1536 int8 components is not kept
    Given embeddings of the wrong width, with a component outside -127 to 127, or all zero
    When trace is asked to keep them
    Then none of them is written

  # Asking for the nearest traces

  @unit
  Scenario: Similar traces are the nearest by cosine distance, nearest first
    Given a project whose traces clustering has embedded
    When a viewer asks for the traces similar to one of them with a limit
    Then the answer is the project's other traces, nearest first, no more than the limit

  @unit
  Scenario: Similar traces never come from another project
    Given an aggregate project over two members that both hold near-identical traces
    When a viewer asks for traces similar to a trace in the first member
    Then only traces of the first member are answered
    And a member the viewer's proof does not read answers trace not found

  @unit
  Scenario: The similar traces read sends only the proof's one project to ClickHouse
    When the nearest traces are read under a proof narrowed to one member
    Then the statement's tenant fence binds that member alone
    And the ranking is cosineDistance against the asked trace's vector, same model, asked trace excluded

  @unit
  Scenario: Every trace embedding repository answers alike
    Given a trace embedded twice
    When its embedding is read back through any trace embedding repository
    Then the later vector is answered as the trace's own

  @unit
  Scenario: A trace clustering never embedded answers not embedded
    Given a trace clustering has not embedded within the last 49 days
    When a viewer asks for traces similar to it
    Then the answer is not embedded, with no traces

  @unit
  Scenario: Embeddings from a different model are never compared
    Given a project whose embeddings model changed between clustering runs
    When a viewer asks for traces similar to a trace
    Then only traces embedded by that trace's model are ranked

  @unit
  Scenario: The similar traces read asks for traces:view
    When a viewer without traces:view asks for similar traces
    Then the route refuses before trace is asked
    And a viewer with traces:view gets the answer, with ten traces when no limit is given
