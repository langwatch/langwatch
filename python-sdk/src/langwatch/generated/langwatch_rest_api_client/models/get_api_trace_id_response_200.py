from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_trace_id_response_200_error_type_0 import GetApiTraceIdResponse200ErrorType0
    from ..models.get_api_trace_id_response_200_evaluations_item import GetApiTraceIdResponse200EvaluationsItem
    from ..models.get_api_trace_id_response_200_input import GetApiTraceIdResponse200Input
    from ..models.get_api_trace_id_response_200_metadata import GetApiTraceIdResponse200Metadata
    from ..models.get_api_trace_id_response_200_metrics import GetApiTraceIdResponse200Metrics
    from ..models.get_api_trace_id_response_200_output import GetApiTraceIdResponse200Output
    from ..models.get_api_trace_id_response_200_spans_item import GetApiTraceIdResponse200SpansItem
    from ..models.get_api_trace_id_response_200_timestamps import GetApiTraceIdResponse200Timestamps


T = TypeVar("T", bound="GetApiTraceIdResponse200")


@_attrs_define
class GetApiTraceIdResponse200:
    """
    Attributes:
        trace_id (str | Unset):  Example: trace_BKZL_X0TKSD4oa1aBJTc_.
        project_id (str | Unset):  Example: KAXYxPR8MUgTcP8CF193y.
        metadata (GetApiTraceIdResponse200Metadata | Unset):
        timestamps (GetApiTraceIdResponse200Timestamps | Unset):
        input_ (GetApiTraceIdResponse200Input | Unset):
        output (GetApiTraceIdResponse200Output | Unset):
        metrics (GetApiTraceIdResponse200Metrics | Unset):
        error (GetApiTraceIdResponse200ErrorType0 | None | Unset):
        indexing_md5s (list[str] | Unset):  Example: ['cccd21e0b70c706034dfd9f7772816a3'].
        spans (list[GetApiTraceIdResponse200SpansItem] | Unset):
        evaluations (list[GetApiTraceIdResponse200EvaluationsItem] | Unset):
    """

    trace_id: str | Unset = UNSET
    project_id: str | Unset = UNSET
    metadata: GetApiTraceIdResponse200Metadata | Unset = UNSET
    timestamps: GetApiTraceIdResponse200Timestamps | Unset = UNSET
    input_: GetApiTraceIdResponse200Input | Unset = UNSET
    output: GetApiTraceIdResponse200Output | Unset = UNSET
    metrics: GetApiTraceIdResponse200Metrics | Unset = UNSET
    error: GetApiTraceIdResponse200ErrorType0 | None | Unset = UNSET
    indexing_md5s: list[str] | Unset = UNSET
    spans: list[GetApiTraceIdResponse200SpansItem] | Unset = UNSET
    evaluations: list[GetApiTraceIdResponse200EvaluationsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_trace_id_response_200_error_type_0 import GetApiTraceIdResponse200ErrorType0

        trace_id = self.trace_id

        project_id = self.project_id

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        timestamps: dict[str, Any] | Unset = UNSET
        if not isinstance(self.timestamps, Unset):
            timestamps = self.timestamps.to_dict()

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        output: dict[str, Any] | Unset = UNSET
        if not isinstance(self.output, Unset):
            output = self.output.to_dict()

        metrics: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metrics, Unset):
            metrics = self.metrics.to_dict()

        error: dict[str, Any] | None | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        elif isinstance(self.error, GetApiTraceIdResponse200ErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        indexing_md5s: list[str] | Unset = UNSET
        if not isinstance(self.indexing_md5s, Unset):
            indexing_md5s = self.indexing_md5s

        spans: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.spans, Unset):
            spans = []
            for spans_item_data in self.spans:
                spans_item = spans_item_data.to_dict()
                spans.append(spans_item)

        evaluations: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evaluations, Unset):
            evaluations = []
            for evaluations_item_data in self.evaluations:
                evaluations_item = evaluations_item_data.to_dict()
                evaluations.append(evaluations_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if project_id is not UNSET:
            field_dict["project_id"] = project_id
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if timestamps is not UNSET:
            field_dict["timestamps"] = timestamps
        if input_ is not UNSET:
            field_dict["input"] = input_
        if output is not UNSET:
            field_dict["output"] = output
        if metrics is not UNSET:
            field_dict["metrics"] = metrics
        if error is not UNSET:
            field_dict["error"] = error
        if indexing_md5s is not UNSET:
            field_dict["indexing_md5s"] = indexing_md5s
        if spans is not UNSET:
            field_dict["spans"] = spans
        if evaluations is not UNSET:
            field_dict["evaluations"] = evaluations

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_trace_id_response_200_error_type_0 import GetApiTraceIdResponse200ErrorType0
        from ..models.get_api_trace_id_response_200_evaluations_item import GetApiTraceIdResponse200EvaluationsItem
        from ..models.get_api_trace_id_response_200_input import GetApiTraceIdResponse200Input
        from ..models.get_api_trace_id_response_200_metadata import GetApiTraceIdResponse200Metadata
        from ..models.get_api_trace_id_response_200_metrics import GetApiTraceIdResponse200Metrics
        from ..models.get_api_trace_id_response_200_output import GetApiTraceIdResponse200Output
        from ..models.get_api_trace_id_response_200_spans_item import GetApiTraceIdResponse200SpansItem
        from ..models.get_api_trace_id_response_200_timestamps import GetApiTraceIdResponse200Timestamps

        d = dict(src_dict)
        trace_id = d.pop("trace_id", UNSET)

        project_id = d.pop("project_id", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: GetApiTraceIdResponse200Metadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = GetApiTraceIdResponse200Metadata.from_dict(_metadata)

        _timestamps = d.pop("timestamps", UNSET)
        timestamps: GetApiTraceIdResponse200Timestamps | Unset
        if isinstance(_timestamps, Unset):
            timestamps = UNSET
        else:
            timestamps = GetApiTraceIdResponse200Timestamps.from_dict(_timestamps)

        _input_ = d.pop("input", UNSET)
        input_: GetApiTraceIdResponse200Input | Unset
        if isinstance(_input_, Unset):
            input_ = UNSET
        else:
            input_ = GetApiTraceIdResponse200Input.from_dict(_input_)

        _output = d.pop("output", UNSET)
        output: GetApiTraceIdResponse200Output | Unset
        if isinstance(_output, Unset):
            output = UNSET
        else:
            output = GetApiTraceIdResponse200Output.from_dict(_output)

        _metrics = d.pop("metrics", UNSET)
        metrics: GetApiTraceIdResponse200Metrics | Unset
        if isinstance(_metrics, Unset):
            metrics = UNSET
        else:
            metrics = GetApiTraceIdResponse200Metrics.from_dict(_metrics)

        def _parse_error(data: object) -> GetApiTraceIdResponse200ErrorType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = GetApiTraceIdResponse200ErrorType0.from_dict(data)

                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiTraceIdResponse200ErrorType0 | None | Unset, data)

        error = _parse_error(d.pop("error", UNSET))

        indexing_md5s = cast(list[str], d.pop("indexing_md5s", UNSET))

        _spans = d.pop("spans", UNSET)
        spans: list[GetApiTraceIdResponse200SpansItem] | Unset = UNSET
        if _spans is not UNSET:
            spans = []
            for spans_item_data in _spans:
                spans_item = GetApiTraceIdResponse200SpansItem.from_dict(spans_item_data)

                spans.append(spans_item)

        _evaluations = d.pop("evaluations", UNSET)
        evaluations: list[GetApiTraceIdResponse200EvaluationsItem] | Unset = UNSET
        if _evaluations is not UNSET:
            evaluations = []
            for evaluations_item_data in _evaluations:
                evaluations_item = GetApiTraceIdResponse200EvaluationsItem.from_dict(evaluations_item_data)

                evaluations.append(evaluations_item)

        get_api_trace_id_response_200 = cls(
            trace_id=trace_id,
            project_id=project_id,
            metadata=metadata,
            timestamps=timestamps,
            input_=input_,
            output=output,
            metrics=metrics,
            error=error,
            indexing_md5s=indexing_md5s,
            spans=spans,
            evaluations=evaluations,
        )

        get_api_trace_id_response_200.additional_properties = d
        return get_api_trace_id_response_200

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
