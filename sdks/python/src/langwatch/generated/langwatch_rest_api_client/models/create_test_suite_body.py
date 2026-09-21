from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_test_suite_body_evaluators_item import CreateTestSuiteBodyEvaluatorsItem
    from ..models.create_test_suite_body_fields_item import CreateTestSuiteBodyFieldsItem


T = TypeVar("T", bound="CreateTestSuiteBody")


@_attrs_define
class CreateTestSuiteBody:
    """
    Attributes:
        name (str): The test suite name, as it reads in the platform.
        fields (list[CreateTestSuiteBodyFieldsItem] | Unset): The fields the test suite declares, in the order the
            platform shows them. Up to 30. An identifier is lowercase letters, digits and underscores, starting with a
            letter; the type is text, number or boolean.
        evaluators (list[CreateTestSuiteBodyEvaluatorsItem] | Unset): The evaluators that run after every scenario run.
            Up to 20. A required evaluator that fails fails the scenario; a score-only evaluator reports and never gates.
    """

    name: str
    fields: list[CreateTestSuiteBodyFieldsItem] | Unset = UNSET
    evaluators: list[CreateTestSuiteBodyEvaluatorsItem] | Unset = UNSET
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
        field_dict.update(
            {
                "name": name,
            }
        )
        if fields is not UNSET:
            field_dict["fields"] = fields
        if evaluators is not UNSET:
            field_dict["evaluators"] = evaluators

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_test_suite_body_evaluators_item import CreateTestSuiteBodyEvaluatorsItem
        from ..models.create_test_suite_body_fields_item import CreateTestSuiteBodyFieldsItem

        d = dict(src_dict)
        name = d.pop("name")

        _fields = d.pop("fields", UNSET)
        fields: list[CreateTestSuiteBodyFieldsItem] | Unset = UNSET
        if _fields is not UNSET:
            fields = []
            for fields_item_data in _fields:
                fields_item = CreateTestSuiteBodyFieldsItem.from_dict(fields_item_data)

                fields.append(fields_item)

        _evaluators = d.pop("evaluators", UNSET)
        evaluators: list[CreateTestSuiteBodyEvaluatorsItem] | Unset = UNSET
        if _evaluators is not UNSET:
            evaluators = []
            for evaluators_item_data in _evaluators:
                evaluators_item = CreateTestSuiteBodyEvaluatorsItem.from_dict(evaluators_item_data)

                evaluators.append(evaluators_item)

        create_test_suite_body = cls(
            name=name,
            fields=fields,
            evaluators=evaluators,
        )

        create_test_suite_body.additional_properties = d
        return create_test_suite_body

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
