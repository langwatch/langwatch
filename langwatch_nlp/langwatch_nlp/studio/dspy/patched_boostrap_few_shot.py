import random
from typing import Optional
import dspy

from langwatch_nlp.studio.types.dsl import Entry
from langwatch_nlp.studio.utils import get_node_by_id


class ExampleWithEntryMap(dspy.Example):
    def __init__(self, base=None, **kwargs):
        super().__init__(base, **kwargs)
        self._map = {}

    def with_map_from_workflow(self, workflow):
        all_keys = self.inputs().keys() + self.labels().keys()
        for edge in workflow.edges:
            source = get_node_by_id(workflow, edge.source)
            if not source or not isinstance(source.data, Entry):
                continue

            target = get_node_by_id(workflow, edge.target)
            if not target:
                continue

            target_output_keys = [
                field.identifier for field in (target.data.outputs or [])
            ]
            all_outputs_presents = all(key in all_keys for key in target_output_keys)
            if not all_outputs_presents:
                continue

            if edge.target not in self._map:
                self._map[edge.target] = {k: k for k in target_output_keys}
            self._map[edge.target][edge.sourceHandle.split(".")[-1]] = (
                edge.targetHandle.split(".")[-1]
            )

        return self

    def map_for_node(self, node_id) -> Optional[dspy.Example]:
        if node_id in self._map:
            new_sample = {}
            for key, value in self.items():
                if key in self._map[node_id]:
                    new_sample[self._map[node_id][key]] = value
            if len(new_sample.keys()) == 0:
                return None

            return dspy.Example(**new_sample)
        return None


map_labeled_examples = False


def patch_labeled_few_shot_once():
    global map_labeled_examples
    map_labeled_examples = True


_original_compile = dspy.LabeledFewShot.compile


class PatchedLabeledFewShot(dspy.LabeledFewShot):
    def compile(self, student, *, trainset, sample=True):
        global map_labeled_examples

        if not map_labeled_examples:
            return _original_compile(self, student, trainset=trainset, sample=sample)

        map_labeled_examples = False

        self.student = student.reset_copy()
        self.trainset = trainset

        if len(self.trainset) == 0:
            return self.student

        rng = random.Random(0)

        for predictor in self.student.predictors():
            if not hasattr(predictor, "_node_id"):
                continue

            if sample:
                samples = rng.sample(self.trainset, min(self.k, len(self.trainset)))
            else:
                samples = self.trainset[: min(self.k, len(self.trainset))]

            samples = [demo.map_for_node(predictor._node_id) for demo in samples]
            samples = [demo for demo in samples if demo is not None]
            if len(samples) == 0:
                continue

            predictor.demos = samples

        return self.student


dspy.LabeledFewShot.compile = PatchedLabeledFewShot.compile  # type: ignore


class PatchedBootstrapFewShot(dspy.BootstrapFewShot):
    def _train(self):
        rng = random.Random(0)
        raw_demos: list[ExampleWithEntryMap] = self.validation

        for name, predictor in self.student.named_predictors():
            augmented_demos = self.name2traces[name][: self.max_bootstrapped_demos]

            sample_size = min(
                self.max_labeled_demos - len(augmented_demos), len(raw_demos)
            )
            sample_size = max(0, sample_size)

            raw_demos = rng.sample(raw_demos, sample_size)
            if not hasattr(predictor, "_node_id"):
                labeled_demos = []
            else:
                labeled_demos = [
                    demo.map_for_node(predictor._node_id) for demo in raw_demos
                ]
                labeled_demos = [demo for demo in labeled_demos if demo is not None]

            predictor.demos = augmented_demos + labeled_demos

        return self.student


dspy.BootstrapFewShot._train = PatchedBootstrapFewShot._train  # type: ignore
