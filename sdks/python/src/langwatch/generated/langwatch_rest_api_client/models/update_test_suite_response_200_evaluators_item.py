from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.update_test_suite_response_200_evaluators_item_mappings import (
        UpdateTestSuiteResponse200EvaluatorsItemMappings,
    )


T = TypeVar("T", bound="UpdateTestSuiteResponse200EvaluatorsItem")


@_attrs_define
class UpdateTestSuiteResponse200EvaluatorsItem:
    """One evaluator that runs after every scenario run, with where each of its inputs reads from.

    Attributes:
        id (str): The attachment id. Stable across edits of the attachment.
        evaluator_id (str): The id of the saved evaluator this attachment runs.
        required (bool): Whether a failing result fails the scenario. A score-only evaluator reports and never gates.
        mappings (UpdateTestSuiteResponse200EvaluatorsItemMappings): Where each evaluator input reads its value, keyed
            by input name. Inputs left out are unmapped; a required input left unmapped refuses the run.
    """

    id: str
    evaluator_id: str
    required: bool
    mappings: UpdateTestSuiteResponse200EvaluatorsItemMappings

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        evaluator_id = self.evaluator_id

        required = self.required

        mappings = self.mappings.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "evaluatorId": evaluator_id,
                "required": required,
                "mappings": mappings,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_test_suite_response_200_evaluators_item_mappings import (
            UpdateTestSuiteResponse200EvaluatorsItemMappings,
        )

        d = dict(src_dict)
        id = d.pop("id")

        evaluator_id = d.pop("evaluatorId")

        required = d.pop("required")

        mappings = UpdateTestSuiteResponse200EvaluatorsItemMappings.from_dict(d.pop("mappings"))

        update_test_suite_response_200_evaluators_item = cls(
            id=id,
            evaluator_id=evaluator_id,
            required=required,
            mappings=mappings,
        )

        return update_test_suite_response_200_evaluators_item
