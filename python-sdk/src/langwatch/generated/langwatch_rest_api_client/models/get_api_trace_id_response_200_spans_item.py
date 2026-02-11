from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_trace_id_response_200_spans_item_error_type_0 import (
        GetApiTraceIdResponse200SpansItemErrorType0,
    )
    from ..models.get_api_trace_id_response_200_spans_item_input import GetApiTraceIdResponse200SpansItemInput
    from ..models.get_api_trace_id_response_200_spans_item_metrics import GetApiTraceIdResponse200SpansItemMetrics
    from ..models.get_api_trace_id_response_200_spans_item_output import GetApiTraceIdResponse200SpansItemOutput
    from ..models.get_api_trace_id_response_200_spans_item_params import GetApiTraceIdResponse200SpansItemParams
    from ..models.get_api_trace_id_response_200_spans_item_timestamps import GetApiTraceIdResponse200SpansItemTimestamps


T = TypeVar("T", bound="GetApiTraceIdResponse200SpansItem")


@_attrs_define
class GetApiTraceIdResponse200SpansItem:
    """
    Attributes:
        trace_id (str | Unset):  Example: trace_BKZL_X0TKSD4oa1aBJTc_.
        span_id (str | Unset):  Example: span_h1xUkcUJilhudDrLeQbR_.
        timestamps (GetApiTraceIdResponse200SpansItemTimestamps | Unset):
        type_ (str | Unset):  Example: llm.
        error (GetApiTraceIdResponse200SpansItemErrorType0 | None | Unset):
        params (GetApiTraceIdResponse200SpansItemParams | Unset):
        project_id (str | Unset):  Example: KAXYxPR8MUgTcP8CF193y.
        parent_id (None | str | Unset):  Example: span_ijZNjUMTz3ys0Z0YKwF_T.
        name (None | str | Unset):
        model (str | Unset):  Example: openai/gpt-4o.
        metrics (GetApiTraceIdResponse200SpansItemMetrics | Unset):
        input_ (GetApiTraceIdResponse200SpansItemInput | Unset):
        output (GetApiTraceIdResponse200SpansItemOutput | Unset):
    """

    trace_id: str | Unset = UNSET
    span_id: str | Unset = UNSET
    timestamps: GetApiTraceIdResponse200SpansItemTimestamps | Unset = UNSET
    type_: str | Unset = UNSET
    error: GetApiTraceIdResponse200SpansItemErrorType0 | None | Unset = UNSET
    params: GetApiTraceIdResponse200SpansItemParams | Unset = UNSET
    project_id: str | Unset = UNSET
    parent_id: None | str | Unset = UNSET
    name: None | str | Unset = UNSET
    model: str | Unset = UNSET
    metrics: GetApiTraceIdResponse200SpansItemMetrics | Unset = UNSET
    input_: GetApiTraceIdResponse200SpansItemInput | Unset = UNSET
    output: GetApiTraceIdResponse200SpansItemOutput | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_trace_id_response_200_spans_item_error_type_0 import (
            GetApiTraceIdResponse200SpansItemErrorType0,
        )

        trace_id = self.trace_id

        span_id = self.span_id

        timestamps: dict[str, Any] | Unset = UNSET
        if not isinstance(self.timestamps, Unset):
            timestamps = self.timestamps.to_dict()

        type_ = self.type_

        error: dict[str, Any] | None | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        elif isinstance(self.error, GetApiTraceIdResponse200SpansItemErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        params: dict[str, Any] | Unset = UNSET
        if not isinstance(self.params, Unset):
            params = self.params.to_dict()

        project_id = self.project_id

        parent_id: None | str | Unset
        if isinstance(self.parent_id, Unset):
            parent_id = UNSET
        else:
            parent_id = self.parent_id

        name: None | str | Unset
        if isinstance(self.name, Unset):
            name = UNSET
        else:
            name = self.name

        model = self.model

        metrics: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metrics, Unset):
            metrics = self.metrics.to_dict()

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        output: dict[str, Any] | Unset = UNSET
        if not isinstance(self.output, Unset):
            output = self.output.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if span_id is not UNSET:
            field_dict["span_id"] = span_id
        if timestamps is not UNSET:
            field_dict["timestamps"] = timestamps
        if type_ is not UNSET:
            field_dict["type"] = type_
        if error is not UNSET:
            field_dict["error"] = error
        if params is not UNSET:
            field_dict["params"] = params
        if project_id is not UNSET:
            field_dict["project_id"] = project_id
        if parent_id is not UNSET:
            field_dict["parent_id"] = parent_id
        if name is not UNSET:
            field_dict["name"] = name
        if model is not UNSET:
            field_dict["model"] = model
        if metrics is not UNSET:
            field_dict["metrics"] = metrics
        if input_ is not UNSET:
            field_dict["input"] = input_
        if output is not UNSET:
            field_dict["output"] = output

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_trace_id_response_200_spans_item_error_type_0 import (
            GetApiTraceIdResponse200SpansItemErrorType0,
        )
        from ..models.get_api_trace_id_response_200_spans_item_input import GetApiTraceIdResponse200SpansItemInput
        from ..models.get_api_trace_id_response_200_spans_item_metrics import GetApiTraceIdResponse200SpansItemMetrics
        from ..models.get_api_trace_id_response_200_spans_item_output import GetApiTraceIdResponse200SpansItemOutput
        from ..models.get_api_trace_id_response_200_spans_item_params import GetApiTraceIdResponse200SpansItemParams
        from ..models.get_api_trace_id_response_200_spans_item_timestamps import (
            GetApiTraceIdResponse200SpansItemTimestamps,
        )

        d = dict(src_dict)
        trace_id = d.pop("trace_id", UNSET)

        span_id = d.pop("span_id", UNSET)

        _timestamps = d.pop("timestamps", UNSET)
        timestamps: GetApiTraceIdResponse200SpansItemTimestamps | Unset
        if isinstance(_timestamps, Unset):
            timestamps = UNSET
        else:
            timestamps = GetApiTraceIdResponse200SpansItemTimestamps.from_dict(_timestamps)

        type_ = d.pop("type", UNSET)

        def _parse_error(data: object) -> GetApiTraceIdResponse200SpansItemErrorType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = GetApiTraceIdResponse200SpansItemErrorType0.from_dict(data)

                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetApiTraceIdResponse200SpansItemErrorType0 | None | Unset, data)

        error = _parse_error(d.pop("error", UNSET))

        _params = d.pop("params", UNSET)
        params: GetApiTraceIdResponse200SpansItemParams | Unset
        if isinstance(_params, Unset):
            params = UNSET
        else:
            params = GetApiTraceIdResponse200SpansItemParams.from_dict(_params)

        project_id = d.pop("project_id", UNSET)

        def _parse_parent_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        parent_id = _parse_parent_id(d.pop("parent_id", UNSET))

        def _parse_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        name = _parse_name(d.pop("name", UNSET))

        model = d.pop("model", UNSET)

        _metrics = d.pop("metrics", UNSET)
        metrics: GetApiTraceIdResponse200SpansItemMetrics | Unset
        if isinstance(_metrics, Unset):
            metrics = UNSET
        else:
            metrics = GetApiTraceIdResponse200SpansItemMetrics.from_dict(_metrics)

        _input_ = d.pop("input", UNSET)
        input_: GetApiTraceIdResponse200SpansItemInput | Unset
        if isinstance(_input_, Unset):
            input_ = UNSET
        else:
            input_ = GetApiTraceIdResponse200SpansItemInput.from_dict(_input_)

        _output = d.pop("output", UNSET)
        output: GetApiTraceIdResponse200SpansItemOutput | Unset
        if isinstance(_output, Unset):
            output = UNSET
        else:
            output = GetApiTraceIdResponse200SpansItemOutput.from_dict(_output)

        get_api_trace_id_response_200_spans_item = cls(
            trace_id=trace_id,
            span_id=span_id,
            timestamps=timestamps,
            type_=type_,
            error=error,
            params=params,
            project_id=project_id,
            parent_id=parent_id,
            name=name,
            model=model,
            metrics=metrics,
            input_=input_,
            output=output,
        )

        get_api_trace_id_response_200_spans_item.additional_properties = d
        return get_api_trace_id_response_200_spans_item

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
