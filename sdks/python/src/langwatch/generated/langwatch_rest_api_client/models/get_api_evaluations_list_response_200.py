from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_evaluations_list_response_200_evaluators import GetApiEvaluationsListResponse200Evaluators


T = TypeVar("T", bound="GetApiEvaluationsListResponse200")


@_attrs_define
class GetApiEvaluationsListResponse200:
    """
    Attributes:
        evaluators (GetApiEvaluationsListResponse200Evaluators): Keyed by evaluator id, the value you put in the
            evaluate path
    """

    evaluators: GetApiEvaluationsListResponse200Evaluators

    def to_dict(self) -> dict[str, Any]:
        evaluators = self.evaluators.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "evaluators": evaluators,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_evaluations_list_response_200_evaluators import GetApiEvaluationsListResponse200Evaluators

        d = dict(src_dict)
        evaluators = GetApiEvaluationsListResponse200Evaluators.from_dict(d.pop("evaluators"))

        get_api_evaluations_list_response_200 = cls(
            evaluators=evaluators,
        )

        return get_api_evaluations_list_response_200
