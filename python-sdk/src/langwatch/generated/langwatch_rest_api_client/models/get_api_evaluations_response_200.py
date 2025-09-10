from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_evaluations_response_200_evaluators import GetApiEvaluationsResponse200Evaluators


T = TypeVar("T", bound="GetApiEvaluationsResponse200")


@_attrs_define
class GetApiEvaluationsResponse200:
    """
    Attributes:
        evaluators (GetApiEvaluationsResponse200Evaluators):
    """

    evaluators: "GetApiEvaluationsResponse200Evaluators"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        evaluators = self.evaluators.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "evaluators": evaluators,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_evaluations_response_200_evaluators import GetApiEvaluationsResponse200Evaluators

        d = dict(src_dict)
        evaluators = GetApiEvaluationsResponse200Evaluators.from_dict(d.pop("evaluators"))

        get_api_evaluations_response_200 = cls(
            evaluators=evaluators,
        )

        get_api_evaluations_response_200.additional_properties = d
        return get_api_evaluations_response_200

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
