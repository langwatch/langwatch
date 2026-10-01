from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.create_test_suite_response_201_evaluators_item_mappings import (
        CreateTestSuiteResponse201EvaluatorsItemMappings,
    )


T = TypeVar("T", bound="CreateTestSuiteResponse201EvaluatorsItem")


@_attrs_define
class CreateTestSuiteResponse201EvaluatorsItem:
    """One evaluator that runs after every scenario run, with where each of its inputs reads from.

    Attributes:
        id (str): The attachment id. Stable across edits of the attachment.
        evaluator_id (str): The id of the saved evaluator this attachment runs.
        required (bool): Whether a failing result fails the scenario. A score-only evaluator reports and never gates.
        mappings (CreateTestSuiteResponse201EvaluatorsItemMappings): Where each evaluator input reads its value, keyed
            by input name. Inputs left out are unmapped; a required input left unmapped refuses the run.
    """

    id: str
    evaluator_id: str
    required: bool
    mappings: CreateTestSuiteResponse201EvaluatorsItemMappings
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        evaluator_id = self.evaluator_id

        required = self.required

        mappings = self.mappings.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        from ..models.create_test_suite_response_201_evaluators_item_mappings import (
            CreateTestSuiteResponse201EvaluatorsItemMappings,
        )

        d = dict(src_dict)
        id = d.pop("id")

        evaluator_id = d.pop("evaluatorId")

        required = d.pop("required")

        mappings = CreateTestSuiteResponse201EvaluatorsItemMappings.from_dict(d.pop("mappings"))

        create_test_suite_response_201_evaluators_item = cls(
            id=id,
            evaluator_id=evaluator_id,
            required=required,
            mappings=mappings,
        )

        create_test_suite_response_201_evaluators_item.additional_properties = d
        return create_test_suite_response_201_evaluators_item

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
