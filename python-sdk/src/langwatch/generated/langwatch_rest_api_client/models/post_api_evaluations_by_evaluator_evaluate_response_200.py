from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_evaluations_by_evaluator_evaluate_response_200_status import (
    PostApiEvaluationsByEvaluatorEvaluateResponse200Status,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_evaluations_by_evaluator_evaluate_response_200_cost import (
        PostApiEvaluationsByEvaluatorEvaluateResponse200Cost,
    )


T = TypeVar("T", bound="PostApiEvaluationsByEvaluatorEvaluateResponse200")


@_attrs_define
class PostApiEvaluationsByEvaluatorEvaluateResponse200:
    """
    Attributes:
        id (Union[Unset, str]):
        status (Union[Unset, PostApiEvaluationsByEvaluatorEvaluateResponse200Status]):
        result (Union[Unset, Any]):
        cost (Union[Unset, PostApiEvaluationsByEvaluatorEvaluateResponse200Cost]):
        error (Union[Unset, str]):
    """

    id: Union[Unset, str] = UNSET
    status: Union[Unset, PostApiEvaluationsByEvaluatorEvaluateResponse200Status] = UNSET
    result: Union[Unset, Any] = UNSET
    cost: Union[Unset, "PostApiEvaluationsByEvaluatorEvaluateResponse200Cost"] = UNSET
    error: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        status: Union[Unset, str] = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        result = self.result

        cost: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.cost, Unset):
            cost = self.cost.to_dict()

        error = self.error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if status is not UNSET:
            field_dict["status"] = status
        if result is not UNSET:
            field_dict["result"] = result
        if cost is not UNSET:
            field_dict["cost"] = cost
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_evaluations_by_evaluator_evaluate_response_200_cost import (
            PostApiEvaluationsByEvaluatorEvaluateResponse200Cost,
        )

        d = dict(src_dict)
        id = d.pop("id", UNSET)

        _status = d.pop("status", UNSET)
        status: Union[Unset, PostApiEvaluationsByEvaluatorEvaluateResponse200Status]
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = PostApiEvaluationsByEvaluatorEvaluateResponse200Status(_status)

        result = d.pop("result", UNSET)

        _cost = d.pop("cost", UNSET)
        cost: Union[Unset, PostApiEvaluationsByEvaluatorEvaluateResponse200Cost]
        if isinstance(_cost, Unset):
            cost = UNSET
        else:
            cost = PostApiEvaluationsByEvaluatorEvaluateResponse200Cost.from_dict(_cost)

        error = d.pop("error", UNSET)

        post_api_evaluations_by_evaluator_evaluate_response_200 = cls(
            id=id,
            status=status,
            result=result,
            cost=cost,
            error=error,
        )

        post_api_evaluations_by_evaluator_evaluate_response_200.additional_properties = d
        return post_api_evaluations_by_evaluator_evaluate_response_200

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
