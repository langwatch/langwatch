from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_evaluations_response_200_evaluators_additional_property import (
        GetApiEvaluationsResponse200EvaluatorsAdditionalProperty,
    )


T = TypeVar("T", bound="GetApiEvaluationsResponse200Evaluators")


@_attrs_define
class GetApiEvaluationsResponse200Evaluators:
    """ """

    additional_properties: dict[str, "GetApiEvaluationsResponse200EvaluatorsAdditionalProperty"] = _attrs_field(
        init=False, factory=dict
    )

    def to_dict(self) -> dict[str, Any]:
        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_evaluations_response_200_evaluators_additional_property import (
            GetApiEvaluationsResponse200EvaluatorsAdditionalProperty,
        )

        d = dict(src_dict)
        get_api_evaluations_response_200_evaluators = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():
            additional_property = GetApiEvaluationsResponse200EvaluatorsAdditionalProperty.from_dict(prop_dict)

            additional_properties[prop_name] = additional_property

        get_api_evaluations_response_200_evaluators.additional_properties = additional_properties
        return get_api_evaluations_response_200_evaluators

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> "GetApiEvaluationsResponse200EvaluatorsAdditionalProperty":
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: "GetApiEvaluationsResponse200EvaluatorsAdditionalProperty") -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
