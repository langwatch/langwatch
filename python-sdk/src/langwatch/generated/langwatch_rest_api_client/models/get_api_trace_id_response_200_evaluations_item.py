from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_trace_id_response_200_evaluations_item_error import (
        GetApiTraceIdResponse200EvaluationsItemError,
    )
    from ..models.get_api_trace_id_response_200_evaluations_item_timestamps import (
        GetApiTraceIdResponse200EvaluationsItemTimestamps,
    )


T = TypeVar("T", bound="GetApiTraceIdResponse200EvaluationsItem")


@_attrs_define
class GetApiTraceIdResponse200EvaluationsItem:
    """
    Attributes:
        evaluation_id (Union[Unset, str]):  Example: check_VCagriZHNWICSOM09dXjM.
        name (Union[Unset, str]):  Example: Ragas Answer Relevancy.
        type_ (Union[Unset, str]):  Example: ragas/answer_relevancy.
        trace_id (Union[Unset, str]):  Example: trace_BKZL_X0TKSD4oa1aBJTc_.
        project_id (Union[Unset, str]):  Example: KAXYxPR8MUgTcP8CF193y.
        status (Union[Unset, str]):  Example: error.
        timestamps (Union[Unset, GetApiTraceIdResponse200EvaluationsItemTimestamps]):
        error (Union[Unset, GetApiTraceIdResponse200EvaluationsItemError]):
    """

    evaluation_id: Union[Unset, str] = UNSET
    name: Union[Unset, str] = UNSET
    type_: Union[Unset, str] = UNSET
    trace_id: Union[Unset, str] = UNSET
    project_id: Union[Unset, str] = UNSET
    status: Union[Unset, str] = UNSET
    timestamps: Union[Unset, "GetApiTraceIdResponse200EvaluationsItemTimestamps"] = UNSET
    error: Union[Unset, "GetApiTraceIdResponse200EvaluationsItemError"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        evaluation_id = self.evaluation_id

        name = self.name

        type_ = self.type_

        trace_id = self.trace_id

        project_id = self.project_id

        status = self.status

        timestamps: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.timestamps, Unset):
            timestamps = self.timestamps.to_dict()

        error: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.error, Unset):
            error = self.error.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if evaluation_id is not UNSET:
            field_dict["evaluation_id"] = evaluation_id
        if name is not UNSET:
            field_dict["name"] = name
        if type_ is not UNSET:
            field_dict["type"] = type_
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if project_id is not UNSET:
            field_dict["project_id"] = project_id
        if status is not UNSET:
            field_dict["status"] = status
        if timestamps is not UNSET:
            field_dict["timestamps"] = timestamps
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_trace_id_response_200_evaluations_item_error import (
            GetApiTraceIdResponse200EvaluationsItemError,
        )
        from ..models.get_api_trace_id_response_200_evaluations_item_timestamps import (
            GetApiTraceIdResponse200EvaluationsItemTimestamps,
        )

        d = dict(src_dict)
        evaluation_id = d.pop("evaluation_id", UNSET)

        name = d.pop("name", UNSET)

        type_ = d.pop("type", UNSET)

        trace_id = d.pop("trace_id", UNSET)

        project_id = d.pop("project_id", UNSET)

        status = d.pop("status", UNSET)

        _timestamps = d.pop("timestamps", UNSET)
        timestamps: Union[Unset, GetApiTraceIdResponse200EvaluationsItemTimestamps]
        if isinstance(_timestamps, Unset):
            timestamps = UNSET
        else:
            timestamps = GetApiTraceIdResponse200EvaluationsItemTimestamps.from_dict(_timestamps)

        _error = d.pop("error", UNSET)
        error: Union[Unset, GetApiTraceIdResponse200EvaluationsItemError]
        if isinstance(_error, Unset):
            error = UNSET
        else:
            error = GetApiTraceIdResponse200EvaluationsItemError.from_dict(_error)

        get_api_trace_id_response_200_evaluations_item = cls(
            evaluation_id=evaluation_id,
            name=name,
            type_=type_,
            trace_id=trace_id,
            project_id=project_id,
            status=status,
            timestamps=timestamps,
            error=error,
        )

        get_api_trace_id_response_200_evaluations_item.additional_properties = d
        return get_api_trace_id_response_200_evaluations_item

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
