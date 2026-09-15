/**
 * The three published operations of `/api/experiments`, as the document
 * describes them. Prose only: the framework derives the operation id, the
 * security scheme, the path parameters and the request body from the
 * declaration itself.
 */

import type { RestTransportDocs } from "@langwatch/api/rest";

/** Every operation in this family is filed under one tag. */
const TAGS = ["Experiments"] as const;

export const LIST_EXPERIMENTS: RestTransportDocs = {
  summary: "List experiments for the project",
  description:
    "List experiments for the project. Includes a runs count and last-run timestamp per experiment.",
  tags: [...TAGS],
};

export const GET_EXPERIMENT: RestTransportDocs = {
  summary: "Read one experiment",
  description:
    "Read a single experiment by its slug, in the same shape the list returns. Accepts the experiment id as well, so either identifier the list hands back can be used.",
  tags: [...TAGS],
  responses: {
    404: { description: "No experiment with that slug or id in this project" },
  },
};

export const CREATE_EXPERIMENT: RestTransportDocs = {
  summary: "Create an experiment and its setup",
  description:
    "Create an evaluations experiment. Send a setup to start from, or send none and get a blank workbench with one inline dataset. The slug it answers with is what every other experiment endpoint takes.",
  tags: [...TAGS],
  responses: {
    400: {
      description:
        "The setup did not match the schema (experiment_invalid_workbench_state) or points at something that no longer exists (experiment_workbench_missing_reference)",
    },
  },
};

export const INIT_EXPERIMENT: RestTransportDocs = {
  summary: "Create an experiment",
  description:
    "Create an experiment, or return the existing one when the slug is already taken. This is the first call in an experiment run: take the slug back, report results against it, and every run under that slug groups together in the app. The SDKs call this endpoint for you. The body carries `experiment_type` and at least one of `experiment_slug` (the stable slug you choose, which is what makes repeated runs land together) or `experiment_id`; `experiment_name` names it on creation and `workflowId` ties it to an Optimization Studio workflow.",
  tags: [...TAGS],
  responses: {
    400: {
      description:
        "The body was not valid JSON, or neither experiment_slug nor experiment_id was supplied",
    },
    401: { description: "Missing or invalid API key" },
    403: {
      description:
        "The API key lacks experiments:manage, or the plan's experiment limit is already reached",
    },
  },
};

export const LOG_DSPY_STEPS: RestTransportDocs = {
  summary: "Report DSPy optimizer steps",
  description:
    "Report the steps of a DSPy optimizer run against an experiment, so the run's progress and scores show up in the app. Send the steps as an array; the optimizer typically posts each batch as it finishes. Bodies up to 20MB are accepted.",
  tags: [...TAGS],
  responses: {
    400: {
      description:
        "The body was not valid JSON, failed validation, or carried timestamps in seconds rather than milliseconds",
    },
    401: { description: "Missing or invalid API key" },
    500: {
      description:
        "A step could not be stored. The cause is on our side and is logged with the run and step ids; retrying the batch is safe.",
    },
  },
};
