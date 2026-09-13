from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.update_test_suite_body_evaluators_item import UpdateTestSuiteBodyEvaluatorsItem
    from ..models.update_test_suite_body_fields_item import UpdateTestSuiteBodyFieldsItem


T = TypeVar("T", bound="UpdateTestSuiteBody")


@_attrs_define
class UpdateTestSuiteBody:
    """
    Attributes:
        name (str | Unset): The new name. The slug is kept.
        fields (list[UpdateTestSuiteBodyFieldsItem] | Unset): The full list of fields the suite declares. A field an
            attached evaluator still reads cannot be removed: answers 422 suite_field_in_use.
        evaluators (list[UpdateTestSuiteBodyEvaluatorsItem] | Unset): The full list of evaluators attached to the suite.
            An evaluator the project does not hold answers 422 suite_evaluator_not_found; a mapping the run cannot read
            answers 422 suite_evaluator_mapping_invalid.
    """

    name: str | Unset = UNSET
    fields: list[UpdateTestSuiteBodyFieldsItem] | Unset = UNSET
    evaluators: list[UpdateTestSuiteBodyEvaluatorsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        fields: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.fields, Unset):
            fields = []
            for fields_item_data in self.fields:
                fields_item = fields_item_data.to_dict()
                fields.append(fields_item)

        evaluators: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evaluators, Unset):
            evaluators = []
            for evaluators_item_data in self.evaluators:
                evaluators_item = evaluators_item_data.to_dict()
                evaluators.append(evaluators_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if fields is not UNSET:
            field_dict["fields"] = fields
        if evaluators is not UNSET:
            field_dict["evaluators"] = evaluators

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_test_suite_body_evaluators_item import UpdateTestSuiteBodyEvaluatorsItem
        from ..models.update_test_suite_body_fields_item import UpdateTestSuiteBodyFieldsItem

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _fields = d.pop("fields", UNSET)
        fields: list[UpdateTestSuiteBodyFieldsItem] | Unset = UNSET
        if _fields is not UNSET:
            fields = []
            for fields_item_data in _fields:
                fields_item = UpdateTestSuiteBodyFieldsItem.from_dict(fields_item_data)

                fields.append(fields_item)

        _evaluators = d.pop("evaluators", UNSET)
        evaluators: list[UpdateTestSuiteBodyEvaluatorsItem] | Unset = UNSET
        if _evaluators is not UNSET:
            evaluators = []
            for evaluators_item_data in _evaluators:
                evaluators_item = UpdateTestSuiteBodyEvaluatorsItem.from_dict(evaluators_item_data)

                evaluators.append(evaluators_item)

        update_test_suite_body = cls(
            name=name,
            fields=fields,
            evaluators=evaluators,
        )

        update_test_suite_body.additional_properties = d
        return update_test_suite_body

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
