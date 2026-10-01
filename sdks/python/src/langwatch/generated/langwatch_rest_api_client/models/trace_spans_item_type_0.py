from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.span_input_output_type_0 import SpanInputOutputType0
    from ..models.span_input_output_type_1 import SpanInputOutputType1
    from ..models.span_input_output_type_2 import SpanInputOutputType2
    from ..models.span_input_output_type_3 import SpanInputOutputType3
    from ..models.span_input_output_type_4 import SpanInputOutputType4
    from ..models.span_input_output_type_5 import SpanInputOutputType5
    from ..models.span_input_output_type_6 import SpanInputOutputType6
    from ..models.trace_spans_item_type_0_error_type_0 import TraceSpansItemType0ErrorType0
    from ..models.trace_spans_item_type_0_metrics_type_0 import TraceSpansItemType0MetricsType0
    from ..models.trace_spans_item_type_0_params_type_0 import TraceSpansItemType0ParamsType0
    from ..models.trace_spans_item_type_0_timestamps import TraceSpansItemType0Timestamps


T = TypeVar("T", bound="TraceSpansItemType0")


@_attrs_define
class TraceSpansItemType0:
    """
    Attributes:
        span_id (str):
        trace_id (str):
        type_ (Literal['llm']):
        timestamps (TraceSpansItemType0Timestamps):
        parent_id (None | str | Unset):
        name (None | str | Unset):
        input_ (None | SpanInputOutputType0 | SpanInputOutputType1 | SpanInputOutputType2 | SpanInputOutputType3 |
            SpanInputOutputType4 | SpanInputOutputType5 | SpanInputOutputType6 | Unset):
        output (None | SpanInputOutputType0 | SpanInputOutputType1 | SpanInputOutputType2 | SpanInputOutputType3 |
            SpanInputOutputType4 | SpanInputOutputType5 | SpanInputOutputType6 | Unset):
        error (None | TraceSpansItemType0ErrorType0 | Unset):
        metrics (None | TraceSpansItemType0MetricsType0 | Unset):
        params (None | TraceSpansItemType0ParamsType0 | Unset):
        vendor (None | str | Unset):
        model (None | str | Unset):
    """

    span_id: str
    trace_id: str
    type_: Literal["llm"]
    timestamps: TraceSpansItemType0Timestamps
    parent_id: None | str | Unset = UNSET
    name: None | str | Unset = UNSET
    input_: (
        None
        | SpanInputOutputType0
        | SpanInputOutputType1
        | SpanInputOutputType2
        | SpanInputOutputType3
        | SpanInputOutputType4
        | SpanInputOutputType5
        | SpanInputOutputType6
        | Unset
    ) = UNSET
    output: (
        None
        | SpanInputOutputType0
        | SpanInputOutputType1
        | SpanInputOutputType2
        | SpanInputOutputType3
        | SpanInputOutputType4
        | SpanInputOutputType5
        | SpanInputOutputType6
        | Unset
    ) = UNSET
    error: None | TraceSpansItemType0ErrorType0 | Unset = UNSET
    metrics: None | TraceSpansItemType0MetricsType0 | Unset = UNSET
    params: None | TraceSpansItemType0ParamsType0 | Unset = UNSET
    vendor: None | str | Unset = UNSET
    model: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.span_input_output_type_0 import SpanInputOutputType0
        from ..models.span_input_output_type_1 import SpanInputOutputType1
        from ..models.span_input_output_type_2 import SpanInputOutputType2
        from ..models.span_input_output_type_3 import SpanInputOutputType3
        from ..models.span_input_output_type_4 import SpanInputOutputType4
        from ..models.span_input_output_type_5 import SpanInputOutputType5
        from ..models.span_input_output_type_6 import SpanInputOutputType6
        from ..models.trace_spans_item_type_0_error_type_0 import TraceSpansItemType0ErrorType0
        from ..models.trace_spans_item_type_0_metrics_type_0 import TraceSpansItemType0MetricsType0
        from ..models.trace_spans_item_type_0_params_type_0 import TraceSpansItemType0ParamsType0

        span_id = self.span_id

        trace_id = self.trace_id

        type_ = self.type_

        timestamps = self.timestamps.to_dict()

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

        input_: dict[str, Any] | None | Unset
        if isinstance(self.input_, Unset):
            input_ = UNSET
        elif isinstance(self.input_, SpanInputOutputType0):
            input_ = self.input_.to_dict()
        elif isinstance(self.input_, SpanInputOutputType1):
            input_ = self.input_.to_dict()
        elif isinstance(self.input_, SpanInputOutputType2):
            input_ = self.input_.to_dict()
        elif isinstance(self.input_, SpanInputOutputType3):
            input_ = self.input_.to_dict()
        elif isinstance(self.input_, SpanInputOutputType4):
            input_ = self.input_.to_dict()
        elif isinstance(self.input_, SpanInputOutputType5):
            input_ = self.input_.to_dict()
        elif isinstance(self.input_, SpanInputOutputType6):
            input_ = self.input_.to_dict()
        else:
            input_ = self.input_

        output: dict[str, Any] | None | Unset
        if isinstance(self.output, Unset):
            output = UNSET
        elif isinstance(self.output, SpanInputOutputType0):
            output = self.output.to_dict()
        elif isinstance(self.output, SpanInputOutputType1):
            output = self.output.to_dict()
        elif isinstance(self.output, SpanInputOutputType2):
            output = self.output.to_dict()
        elif isinstance(self.output, SpanInputOutputType3):
            output = self.output.to_dict()
        elif isinstance(self.output, SpanInputOutputType4):
            output = self.output.to_dict()
        elif isinstance(self.output, SpanInputOutputType5):
            output = self.output.to_dict()
        elif isinstance(self.output, SpanInputOutputType6):
            output = self.output.to_dict()
        else:
            output = self.output

        error: dict[str, Any] | None | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        elif isinstance(self.error, TraceSpansItemType0ErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        metrics: dict[str, Any] | None | Unset
        if isinstance(self.metrics, Unset):
            metrics = UNSET
        elif isinstance(self.metrics, TraceSpansItemType0MetricsType0):
            metrics = self.metrics.to_dict()
        else:
            metrics = self.metrics

        params: dict[str, Any] | None | Unset
        if isinstance(self.params, Unset):
            params = UNSET
        elif isinstance(self.params, TraceSpansItemType0ParamsType0):
            params = self.params.to_dict()
        else:
            params = self.params

        vendor: None | str | Unset
        if isinstance(self.vendor, Unset):
            vendor = UNSET
        else:
            vendor = self.vendor

        model: None | str | Unset
        if isinstance(self.model, Unset):
            model = UNSET
        else:
            model = self.model

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "span_id": span_id,
                "trace_id": trace_id,
                "type": type_,
                "timestamps": timestamps,
            }
        )
        if parent_id is not UNSET:
            field_dict["parent_id"] = parent_id
        if name is not UNSET:
            field_dict["name"] = name
        if input_ is not UNSET:
            field_dict["input"] = input_
        if output is not UNSET:
            field_dict["output"] = output
        if error is not UNSET:
            field_dict["error"] = error
        if metrics is not UNSET:
            field_dict["metrics"] = metrics
        if params is not UNSET:
            field_dict["params"] = params
        if vendor is not UNSET:
            field_dict["vendor"] = vendor
        if model is not UNSET:
            field_dict["model"] = model

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.span_input_output_type_0 import SpanInputOutputType0
        from ..models.span_input_output_type_1 import SpanInputOutputType1
        from ..models.span_input_output_type_2 import SpanInputOutputType2
        from ..models.span_input_output_type_3 import SpanInputOutputType3
        from ..models.span_input_output_type_4 import SpanInputOutputType4
        from ..models.span_input_output_type_5 import SpanInputOutputType5
        from ..models.span_input_output_type_6 import SpanInputOutputType6
        from ..models.trace_spans_item_type_0_error_type_0 import TraceSpansItemType0ErrorType0
        from ..models.trace_spans_item_type_0_metrics_type_0 import TraceSpansItemType0MetricsType0
        from ..models.trace_spans_item_type_0_params_type_0 import TraceSpansItemType0ParamsType0
        from ..models.trace_spans_item_type_0_timestamps import TraceSpansItemType0Timestamps

        d = dict(src_dict)
        span_id = d.pop("span_id")

        trace_id = d.pop("trace_id")

        type_ = cast(Literal["llm"], d.pop("type"))
        if type_ != "llm":
            raise ValueError(f"type must match const 'llm', got '{type_}'")

        timestamps = TraceSpansItemType0Timestamps.from_dict(d.pop("timestamps"))

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

        def _parse_input_(
            data: object,
        ) -> (
            None
            | SpanInputOutputType0
            | SpanInputOutputType1
            | SpanInputOutputType2
            | SpanInputOutputType3
            | SpanInputOutputType4
            | SpanInputOutputType5
            | SpanInputOutputType6
            | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_0 = SpanInputOutputType0.from_dict(data)

                return componentsschemas_span_input_output_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_1 = SpanInputOutputType1.from_dict(data)

                return componentsschemas_span_input_output_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_2 = SpanInputOutputType2.from_dict(data)

                return componentsschemas_span_input_output_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_3 = SpanInputOutputType3.from_dict(data)

                return componentsschemas_span_input_output_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_4 = SpanInputOutputType4.from_dict(data)

                return componentsschemas_span_input_output_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_5 = SpanInputOutputType5.from_dict(data)

                return componentsschemas_span_input_output_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_6 = SpanInputOutputType6.from_dict(data)

                return componentsschemas_span_input_output_type_6
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | SpanInputOutputType0
                | SpanInputOutputType1
                | SpanInputOutputType2
                | SpanInputOutputType3
                | SpanInputOutputType4
                | SpanInputOutputType5
                | SpanInputOutputType6
                | Unset,
                data,
            )

        input_ = _parse_input_(d.pop("input", UNSET))

        def _parse_output(
            data: object,
        ) -> (
            None
            | SpanInputOutputType0
            | SpanInputOutputType1
            | SpanInputOutputType2
            | SpanInputOutputType3
            | SpanInputOutputType4
            | SpanInputOutputType5
            | SpanInputOutputType6
            | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_0 = SpanInputOutputType0.from_dict(data)

                return componentsschemas_span_input_output_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_1 = SpanInputOutputType1.from_dict(data)

                return componentsschemas_span_input_output_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_2 = SpanInputOutputType2.from_dict(data)

                return componentsschemas_span_input_output_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_3 = SpanInputOutputType3.from_dict(data)

                return componentsschemas_span_input_output_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_4 = SpanInputOutputType4.from_dict(data)

                return componentsschemas_span_input_output_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_5 = SpanInputOutputType5.from_dict(data)

                return componentsschemas_span_input_output_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_span_input_output_type_6 = SpanInputOutputType6.from_dict(data)

                return componentsschemas_span_input_output_type_6
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | SpanInputOutputType0
                | SpanInputOutputType1
                | SpanInputOutputType2
                | SpanInputOutputType3
                | SpanInputOutputType4
                | SpanInputOutputType5
                | SpanInputOutputType6
                | Unset,
                data,
            )

        output = _parse_output(d.pop("output", UNSET))

        def _parse_error(data: object) -> None | TraceSpansItemType0ErrorType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = TraceSpansItemType0ErrorType0.from_dict(data)

                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TraceSpansItemType0ErrorType0 | Unset, data)

        error = _parse_error(d.pop("error", UNSET))

        def _parse_metrics(data: object) -> None | TraceSpansItemType0MetricsType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metrics_type_0 = TraceSpansItemType0MetricsType0.from_dict(data)

                return metrics_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TraceSpansItemType0MetricsType0 | Unset, data)

        metrics = _parse_metrics(d.pop("metrics", UNSET))

        def _parse_params(data: object) -> None | TraceSpansItemType0ParamsType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                params_type_0 = TraceSpansItemType0ParamsType0.from_dict(data)

                return params_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TraceSpansItemType0ParamsType0 | Unset, data)

        params = _parse_params(d.pop("params", UNSET))

        def _parse_vendor(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        vendor = _parse_vendor(d.pop("vendor", UNSET))

        def _parse_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model = _parse_model(d.pop("model", UNSET))

        trace_spans_item_type_0 = cls(
            span_id=span_id,
            trace_id=trace_id,
            type_=type_,
            timestamps=timestamps,
            parent_id=parent_id,
            name=name,
            input_=input_,
            output=output,
            error=error,
            metrics=metrics,
            params=params,
            vendor=vendor,
            model=model,
        )

        trace_spans_item_type_0.additional_properties = d
        return trace_spans_item_type_0

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
