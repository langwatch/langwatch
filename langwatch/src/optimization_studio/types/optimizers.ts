export const OPTIMIZERS = {
  BootstrapFewShot: {
    description:
      "Generates few shot examples (demonstrations), for improving the LLM performance.",
    minimum_train_set: 10,
    params: {
      max_bootstrapped_demos: 4,
      max_labeled_demos: 16,
      max_rounds: 10,
    },
  },
  BootstrapFewShotWithRandomSearch: {
    description:
      "Generates several BootstrapFewShot candidates and randomly searches to find the best.",
    minimum_train_set: 50,
    params: {
      max_bootstrapped_demos: 4,
      max_labeled_demos: 16,
      max_rounds: 10,
      num_candidate_programs: 10,
    },
  },
};
