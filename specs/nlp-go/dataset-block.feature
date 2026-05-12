Feature: Dataset block — entry node reads inline dataset records and emits one row at a time
  The entry node holds a small inline dataset (records as a column-oriented dict)
  and either emits one specific record (entry_selection) or splits the rows into
  train/test sets and emits each row as a separate execution. Output shape must
  match the Python entry node so downstream graph behavior is unchanged.

  See _shared/contract.md §5.

  Background:
    Given nlpgo is listening on :5562

  Rule: Inline dataset deserializes column-oriented records

    @unit @unimplemented
    Scenario: a dataset with three columns of three rows produces three records
      Given an entry node with dataset:
        """
        {
          "records": {
            "input":  ["a", "b", "c"],
            "expected_output": ["x", "y", "z"],
            "id":     [1, 2, 3]
          }
        }
        """
      When the engine materializes the dataset
      Then the engine has 3 records
      And the first record equals {"input": "a", "expected_output": "x", "id": 1}

    @unit @unimplemented
    Scenario: a dataset whose columns have unequal lengths is rejected
      Given an entry node with dataset whose "input" has 3 rows and "expected_output" has 2 rows
      When the engine materializes the dataset
      Then the engine returns a 400 with body {"error": {"type": "invalid_dataset", "reason": "column_length_mismatch"}}

  Rule: entry_selection emits exactly one record by index

    @integration @unimplemented
    Scenario: entry_selection=1 emits the second row only
      Given a workflow whose entry node has 4 records and entry_selection=1
      When I POST /go/studio/execute_sync
      Then the result references exactly one execution
      And the entry node's output equals the second record

    @integration @unimplemented
    Scenario: entry_selection out of bounds returns a 400
      Given a workflow whose entry node has 3 records and entry_selection=10
      When I POST /go/studio/execute_sync
      Then the response status is 400
      And the body contains {"error": {"type": "invalid_dataset", "reason": "entry_selection_out_of_range"}}

  Rule: train/test split is deterministic for a given seed

    @unit @unimplemented
    Scenario Outline: same seed always produces the same split ordering
      Given a dataset with 100 rows, train_size=<train>, test_size=<test>, seed=<seed>
      When the engine computes the split twice
      Then both runs produce the same train indices in the same order
      And both runs produce the same test indices in the same order

      Examples:
        | train | test | seed |
        | 80    | 20   | 42   |
        | 70    | 30   | 7    |
        | 50    | 50   | 12345|

    @unit @unimplemented
    Scenario: train_size + test_size > total rows is rejected
      Given a dataset with 10 rows, train_size=8, test_size=5
      When the engine computes the split
      Then the engine returns a 400 with body {"error": {"type": "invalid_dataset", "reason": "split_exceeds_dataset_size"}}

  Rule: Iterated execution emits one stream per record

    @integration @unimplemented
    Scenario: a workflow with no entry_selection runs once per training record
      Given a workflow with 5 training records and no entry_selection
      When I POST /go/studio/execute and read the SSE stream
      Then I receive 5 distinct trace_ids in "execution_state_change" events
      And I receive 5 "done" events
      And each record's input appears in exactly one trace's entry-node output

  Rule: Output field types match the dataset declaration

    @unit @unimplemented
    Scenario Outline: typed columns are emitted with the declared type
      Given a dataset with column "v" declared as <field_type> and value <raw>
      When the entry node emits the record
      Then the value is delivered to downstream nodes as <go_type> with value <expected>

      Examples:
        | field_type | raw       | go_type | expected |
        | int        | "42"      | int64   | 42       |
        | float      | "3.14"    | float64 | 3.14     |
        | bool       | "true"    | bool    | true     |
        | str        | 12345     | string  | "12345"  |

  Rule: Parity with Python entry node

    @integration @parity @unimplemented
    Scenario: same dataset + seed produce identical record ordering on Go and Python
      Given a fixture dataset with 50 rows and seed=42
      When I run the dataset materializer in Go and in Python
      Then the train index list is byte-equivalent
      And the test index list is byte-equivalent
