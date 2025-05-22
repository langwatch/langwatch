from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

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
        trace_id (Union[Unset, str]):  Example: trace_BKZL_X0TKSD4oa1aBJTc_.
        project_id (Union[Unset, str]):  Example: KAXYxPR8MUgTcP8CF193y.
        metadata (Union[Unset, GetApiTraceIdResponse200Metadata]):
        timestamps (Union[Unset, GetApiTraceIdResponse200Timestamps]):
        input_ (Union[Unset, GetApiTraceIdResponse200Input]):
        output (Union[Unset, GetApiTraceIdResponse200Output]):
        metrics (Union[Unset, GetApiTraceIdResponse200Metrics]):
        error (Union['GetApiTraceIdResponse200ErrorType0', None, Unset]):
        indexing_md5s (Union[Unset, list[str]]):  Example: ['cccd21e0b70c706034dfd9f7772816a3'].
        spans (Union[Unset, list['GetApiTraceIdResponse200SpansItem']]):
        evaluations (Union[Unset, list['GetApiTraceIdResponse200EvaluationsItem']]):
    """

    trace_id: Union[Unset, str] = UNSET
    project_id: Union[Unset, str] = UNSET
    metadata: Union[Unset, "GetApiTraceIdResponse200Metadata"] = UNSET
    timestamps: Union[Unset, "GetApiTraceIdResponse200Timestamps"] = UNSET
    input_: Union[Unset, "GetApiTraceIdResponse200Input"] = UNSET
    output: Union[Unset, "GetApiTraceIdResponse200Output"] = UNSET
    metrics: Union[Unset, "GetApiTraceIdResponse200Metrics"] = UNSET
    error: Union["GetApiTraceIdResponse200ErrorType0", None, Unset] = UNSET
    indexing_md5s: Union[Unset, list[str]] = UNSET
    spans: Union[Unset, list["GetApiTraceIdResponse200SpansItem"]] = UNSET
    evaluations: Union[Unset, list["GetApiTraceIdResponse200EvaluationsItem"]] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_trace_id_response_200_error_type_0 import GetApiTraceIdResponse200ErrorType0

        trace_id = self.trace_id

        project_id = self.project_id

        metadata: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        timestamps: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.timestamps, Unset):
            timestamps = self.timestamps.to_dict()

        input_: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        output: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.output, Unset):
            output = self.output.to_dict()

        metrics: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.metrics, Unset):
            metrics = self.metrics.to_dict()

        error: Union[None, Unset, dict[str, Any]]
        if isinstance(self.error, Unset):
            error = UNSET
        elif isinstance(self.error, GetApiTraceIdResponse200ErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        indexing_md5s: Union[Unset, list[str]] = UNSET
        if not isinstance(self.indexing_md5s, Unset):
            indexing_md5s = self.indexing_md5s

        spans: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.spans, Unset):
            spans = []
            for spans_item_data in self.spans:
                spans_item = spans_item_data.to_dict()
                spans.append(spans_item)

        evaluations: Union[Unset, list[dict[str, Any]]] = UNSET
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
        metadata: Union[Unset, GetApiTraceIdResponse200Metadata]
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = GetApiTraceIdResponse200Metadata.from_dict(_metadata)

        _timestamps = d.pop("timestamps", UNSET)
        timestamps: Union[Unset, GetApiTraceIdResponse200Timestamps]
        if isinstance(_timestamps, Unset):
            timestamps = UNSET
        else:
            timestamps = GetApiTraceIdResponse200Timestamps.from_dict(_timestamps)

        _input_ = d.pop("input", UNSET)
        input_: Union[Unset, GetApiTraceIdResponse200Input]
        if isinstance(_input_, Unset):
            input_ = UNSET
        else:
            input_ = GetApiTraceIdResponse200Input.from_dict(_input_)

        _output = d.pop("output", UNSET)
        output: Union[Unset, GetApiTraceIdResponse200Output]
        if isinstance(_output, Unset):
            output = UNSET
        else:
            output = GetApiTraceIdResponse200Output.from_dict(_output)

        _metrics = d.pop("metrics", UNSET)
        metrics: Union[Unset, GetApiTraceIdResponse200Metrics]
        if isinstance(_metrics, Unset):
            metrics = UNSET
        else:
            metrics = GetApiTraceIdResponse200Metrics.from_dict(_metrics)

        def _parse_error(data: object) -> Union["GetApiTraceIdResponse200ErrorType0", None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = GetApiTraceIdResponse200ErrorType0.from_dict(data)

                return error_type_0
            except:  # noqa: E722
                pass
            return cast(Union["GetApiTraceIdResponse200ErrorType0", None, Unset], data)

        error = _parse_error(d.pop("error", UNSET))

        indexing_md5s = cast(list[str], d.pop("indexing_md5s", UNSET))

        spans = []
        _spans = d.pop("spans", UNSET)
        for spans_item_data in _spans or []:
            spans_item = GetApiTraceIdResponse200SpansItem.from_dict(spans_item_data)

            spans.append(spans_item)

        evaluations = []
        _evaluations = d.pop("evaluations", UNSET)
        for evaluations_item_data in _evaluations or []:
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
