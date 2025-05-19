from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.evaluation_timestamps import EvaluationTimestamps


T = TypeVar("T", bound="Evaluation")


@_attrs_define
class Evaluation:
    """
    Attributes:
        evaluation_id (Union[Unset, str]):
        score (Union[Unset, float]):
        timestamps (Union[Unset, EvaluationTimestamps]):
        evaluator_id (Union[Unset, str]):
        name (Union[Unset, str]):
        details (Union[Unset, str]):
        passed (Union[Unset, bool]):
        label (Union[None, Unset, str]):
        type_ (Union[Unset, str]):
        status (Union[Unset, str]):
    """

    evaluation_id: Union[Unset, str] = UNSET
    score: Union[Unset, float] = UNSET
    timestamps: Union[Unset, "EvaluationTimestamps"] = UNSET
    evaluator_id: Union[Unset, str] = UNSET
    name: Union[Unset, str] = UNSET
    details: Union[Unset, str] = UNSET
    passed: Union[Unset, bool] = UNSET
    label: Union[None, Unset, str] = UNSET
    type_: Union[Unset, str] = UNSET
    status: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        evaluation_id = self.evaluation_id

        score = self.score

        timestamps: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.timestamps, Unset):
            timestamps = self.timestamps.to_dict()

        evaluator_id = self.evaluator_id

        name = self.name

        details = self.details

        passed = self.passed

        label: Union[None, Unset, str]
        if isinstance(self.label, Unset):
            label = UNSET
        else:
            label = self.label

        type_ = self.type_

        status = self.status

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if evaluation_id is not UNSET:
            field_dict["evaluation_id"] = evaluation_id
        if score is not UNSET:
            field_dict["score"] = score
        if timestamps is not UNSET:
            field_dict["timestamps"] = timestamps
        if evaluator_id is not UNSET:
            field_dict["evaluator_id"] = evaluator_id
        if name is not UNSET:
            field_dict["name"] = name
        if details is not UNSET:
            field_dict["details"] = details
        if passed is not UNSET:
            field_dict["passed"] = passed
        if label is not UNSET:
            field_dict["label"] = label
        if type_ is not UNSET:
            field_dict["type"] = type_
        if status is not UNSET:
            field_dict["status"] = status

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.evaluation_timestamps import EvaluationTimestamps

        d = dict(src_dict)
        evaluation_id = d.pop("evaluation_id", UNSET)

        score = d.pop("score", UNSET)

        _timestamps = d.pop("timestamps", UNSET)
        timestamps: Union[Unset, EvaluationTimestamps]
        if isinstance(_timestamps, Unset):
            timestamps = UNSET
        else:
            timestamps = EvaluationTimestamps.from_dict(_timestamps)

        evaluator_id = d.pop("evaluator_id", UNSET)

        name = d.pop("name", UNSET)

        details = d.pop("details", UNSET)

        passed = d.pop("passed", UNSET)

        def _parse_label(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        label = _parse_label(d.pop("label", UNSET))

        type_ = d.pop("type", UNSET)

        status = d.pop("status", UNSET)

        evaluation = cls(
            evaluation_id=evaluation_id,
            score=score,
            timestamps=timestamps,
            evaluator_id=evaluator_id,
            name=name,
            details=details,
            passed=passed,
            label=label,
            type_=type_,
            status=status,
        )

        evaluation.additional_properties = d
        return evaluation

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
