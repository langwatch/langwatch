from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetApiEvaluationsResponse200EvaluatorsAdditionalProperty")


@_attrs_define
class GetApiEvaluationsResponse200EvaluatorsAdditionalProperty:
    """
    Attributes:
        name (str):
        description (Union[Unset, str]):
        settings_json_schema (Union[Unset, Any]):
    """

    name: str
    description: Union[Unset, str] = UNSET
    settings_json_schema: Union[Unset, Any] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        settings_json_schema = self.settings_json_schema

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if settings_json_schema is not UNSET:
            field_dict["settings_json_schema"] = settings_json_schema

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description", UNSET)

        settings_json_schema = d.pop("settings_json_schema", UNSET)

        get_api_evaluations_response_200_evaluators_additional_property = cls(
            name=name,
            description=description,
            settings_json_schema=settings_json_schema,
        )

        get_api_evaluations_response_200_evaluators_additional_property.additional_properties = d
        return get_api_evaluations_response_200_evaluators_additional_property

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
