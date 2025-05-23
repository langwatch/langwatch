/**
 * This file exports all migration modules to make them available for static imports in Next.js.
 * When adding a new migration file, make sure to add it here as well.
 */

// Import all migrations
import * as add_retention_policy from "./202503020034_add_retention_policy";
import * as create_batch_evaluation_index from "./202409231217_create_batch_evaluation_index";
import * as add_workflow_version_id_to_dspy_steps from "./202409231347_add_workflow_version_id_to_dspy_steps";
import * as remove_embeddings from "./202501111740_remove_embeddings";
import * as add_predicted_to_batch_evaluations from "./202502190833_add_predicted_to_batch_evaluations";
import * as add_evaluation_labels from "./202408112226_add_evaluation_labels";
import * as add_span_id_to_evaluations from "./202408232024_add_span_id_to_evaluations";
import * as add_evaluation_id_migrate_check_id_evaluations from "./202408240457_add_evaluation_id_migrate_check_id_evaluations";
import * as flatten_span_params from "./202408041216_flatten_span_params";
import * as flatten_examples_trace from "./202504241534_flatten_examples_trace";
import * as set_type_for_prompt_metadata from "./202505220000_set_type_for_prompt_metadata";

// Create a mapping object with the original filenames as keys
export const migrations = {
  "202503020034_add_retention_policy": add_retention_policy,
  "202409231217_create_batch_evaluation_index": create_batch_evaluation_index,
  "202409231347_add_workflow_version_id_to_dspy_steps":
    add_workflow_version_id_to_dspy_steps,
  "202501111740_remove_embeddings": remove_embeddings,
  "202502190833_add_predicted_to_batch_evaluations":
    add_predicted_to_batch_evaluations,
  "202408112226_add_evaluation_labels": add_evaluation_labels,
  "202408232024_add_span_id_to_evaluations": add_span_id_to_evaluations,
  "202408240457_add_evaluation_id_migrate_check_id_evaluations":
    add_evaluation_id_migrate_check_id_evaluations,
  "202408041216_flatten_span_params": flatten_span_params,
  "202504241534_flatten_examples_trace": flatten_examples_trace,
  "202505220000_set_type_for_prompt_metadata": set_type_for_prompt_metadata,
};

// Export the migrations object for use in other modules
export default migrations;
