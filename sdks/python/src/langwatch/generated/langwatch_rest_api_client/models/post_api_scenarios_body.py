from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_scenarios_body_parameters_item import PostApiScenariosBodyParametersItem


T = TypeVar("T", bound="PostApiScenariosBody")


@_attrs_define
class PostApiScenariosBody:
    """
    Attributes:
        name (str):
        situation (str):
        criteria (list[str] | Unset):
        labels (list[str] | Unset):
        parameters (list[PostApiScenariosBodyParametersItem] | Unset): The parameters this scenario declares by name,
            each with an optional description and default. A run supplies values for these names, readable from the
            scenario's own text as params.NAME. A parameter marked secret carries no default: its value is supplied per run,
            encrypted, delivered to the target as secrets.NAME, and never readable from the scenario's own text.
        test_suite_id (None | str | Unset): The test suite to file this scenario in. It must name a non-archived test
            suite of the same project. null unfiles the scenario.
    """

    name: str
    situation: str
    criteria: list[str] | Unset = UNSET
    labels: list[str] | Unset = UNSET
    parameters: list[PostApiScenariosBodyParametersItem] | Unset = UNSET
    test_suite_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        situation = self.situation

        criteria: list[str] | Unset = UNSET
        if not isinstance(self.criteria, Unset):
            criteria = self.criteria

        labels: list[str] | Unset = UNSET
        if not isinstance(self.labels, Unset):
            labels = self.labels

        parameters: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = []
            for parameters_item_data in self.parameters:
                parameters_item = parameters_item_data.to_dict()
                parameters.append(parameters_item)

        test_suite_id: None | str | Unset
        if isinstance(self.test_suite_id, Unset):
            test_suite_id = UNSET
        else:
            test_suite_id = self.test_suite_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "situation": situation,
            }
        )
        if criteria is not UNSET:
            field_dict["criteria"] = criteria
        if labels is not UNSET:
            field_dict["labels"] = labels
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if test_suite_id is not UNSET:
            field_dict["testSuiteId"] = test_suite_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_scenarios_body_parameters_item import PostApiScenariosBodyParametersItem

        d = dict(src_dict)
        name = d.pop("name")

        situation = d.pop("situation")

        criteria = cast(list[str], d.pop("criteria", UNSET))

        labels = cast(list[str], d.pop("labels", UNSET))

        _parameters = d.pop("parameters", UNSET)
        parameters: list[PostApiScenariosBodyParametersItem] | Unset = UNSET
        if _parameters is not UNSET:
            parameters = []
            for parameters_item_data in _parameters:
                parameters_item = PostApiScenariosBodyParametersItem.from_dict(parameters_item_data)

                parameters.append(parameters_item)

        def _parse_test_suite_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        test_suite_id = _parse_test_suite_id(d.pop("testSuiteId", UNSET))

        post_api_scenarios_body = cls(
            name=name,
            situation=situation,
            criteria=criteria,
            labels=labels,
            parameters=parameters,
            test_suite_id=test_suite_id,
        )

        post_api_scenarios_body.additional_properties = d
        return post_api_scenarios_body

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
