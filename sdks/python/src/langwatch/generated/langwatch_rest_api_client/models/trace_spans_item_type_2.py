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
    from ..models.trace_spans_item_type_2_error_type_0 import TraceSpansItemType2ErrorType0
    from ..models.trace_spans_item_type_2_metrics_type_0 import TraceSpansItemType2MetricsType0
    from ..models.trace_spans_item_type_2_params_type_0 import TraceSpansItemType2ParamsType0
    from ..models.trace_spans_item_type_2_timestamps import TraceSpansItemType2Timestamps


T = TypeVar("T", bound="TraceSpansItemType2")


@_attrs_define
class TraceSpansItemType2:
    """
    Attributes:
        span_id (str):
        trace_id (str):
        type_ (Literal['agent'] | Literal['chain'] | Literal['client'] | Literal['component'] | Literal['consumer'] |
            Literal['evaluation'] | Literal['guardrail'] | Literal['llm'] | Literal['module'] | Literal['producer'] |
            Literal['rag'] | Literal['server'] | Literal['span'] | Literal['task'] | Literal['tool'] | Literal['unknown'] |
            Literal['workflow']):
        timestamps (TraceSpansItemType2Timestamps):
        parent_id (None | str | Unset):
        name (None | str | Unset):
        input_ (None | SpanInputOutputType0 | SpanInputOutputType1 | SpanInputOutputType2 | SpanInputOutputType3 |
            SpanInputOutputType4 | SpanInputOutputType5 | SpanInputOutputType6 | Unset):
        output (None | SpanInputOutputType0 | SpanInputOutputType1 | SpanInputOutputType2 | SpanInputOutputType3 |
            SpanInputOutputType4 | SpanInputOutputType5 | SpanInputOutputType6 | Unset):
        error (None | TraceSpansItemType2ErrorType0 | Unset):
        metrics (None | TraceSpansItemType2MetricsType0 | Unset):
        params (None | TraceSpansItemType2ParamsType0 | Unset):
    """

    span_id: str
    trace_id: str
    type_: (
        Literal["agent"]
        | Literal["chain"]
        | Literal["client"]
        | Literal["component"]
        | Literal["consumer"]
        | Literal["evaluation"]
        | Literal["guardrail"]
        | Literal["llm"]
        | Literal["module"]
        | Literal["producer"]
        | Literal["rag"]
        | Literal["server"]
        | Literal["span"]
        | Literal["task"]
        | Literal["tool"]
        | Literal["unknown"]
        | Literal["workflow"]
    )
    timestamps: TraceSpansItemType2Timestamps
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
    error: None | TraceSpansItemType2ErrorType0 | Unset = UNSET
    metrics: None | TraceSpansItemType2MetricsType0 | Unset = UNSET
    params: None | TraceSpansItemType2ParamsType0 | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.span_input_output_type_0 import SpanInputOutputType0
        from ..models.span_input_output_type_1 import SpanInputOutputType1
        from ..models.span_input_output_type_2 import SpanInputOutputType2
        from ..models.span_input_output_type_3 import SpanInputOutputType3
        from ..models.span_input_output_type_4 import SpanInputOutputType4
        from ..models.span_input_output_type_5 import SpanInputOutputType5
        from ..models.span_input_output_type_6 import SpanInputOutputType6
        from ..models.trace_spans_item_type_2_error_type_0 import TraceSpansItemType2ErrorType0
        from ..models.trace_spans_item_type_2_metrics_type_0 import TraceSpansItemType2MetricsType0
        from ..models.trace_spans_item_type_2_params_type_0 import TraceSpansItemType2ParamsType0

        span_id = self.span_id

        trace_id = self.trace_id

        type_: (
            Literal["agent"]
            | Literal["chain"]
            | Literal["client"]
            | Literal["component"]
            | Literal["consumer"]
            | Literal["evaluation"]
            | Literal["guardrail"]
            | Literal["llm"]
            | Literal["module"]
            | Literal["producer"]
            | Literal["rag"]
            | Literal["server"]
            | Literal["span"]
            | Literal["task"]
            | Literal["tool"]
            | Literal["unknown"]
            | Literal["workflow"]
        )
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
        elif isinstance(self.error, TraceSpansItemType2ErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        metrics: dict[str, Any] | None | Unset
        if isinstance(self.metrics, Unset):
            metrics = UNSET
        elif isinstance(self.metrics, TraceSpansItemType2MetricsType0):
            metrics = self.metrics.to_dict()
        else:
            metrics = self.metrics

        params: dict[str, Any] | None | Unset
        if isinstance(self.params, Unset):
            params = UNSET
        elif isinstance(self.params, TraceSpansItemType2ParamsType0):
            params = self.params.to_dict()
        else:
            params = self.params

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
        from ..models.trace_spans_item_type_2_error_type_0 import TraceSpansItemType2ErrorType0
        from ..models.trace_spans_item_type_2_metrics_type_0 import TraceSpansItemType2MetricsType0
        from ..models.trace_spans_item_type_2_params_type_0 import TraceSpansItemType2ParamsType0
        from ..models.trace_spans_item_type_2_timestamps import TraceSpansItemType2Timestamps

        d = dict(src_dict)
        span_id = d.pop("span_id")

        trace_id = d.pop("trace_id")

        def _parse_type_(
            data: object,
        ) -> (
            Literal["agent"]
            | Literal["chain"]
            | Literal["client"]
            | Literal["component"]
            | Literal["consumer"]
            | Literal["evaluation"]
            | Literal["guardrail"]
            | Literal["llm"]
            | Literal["module"]
            | Literal["producer"]
            | Literal["rag"]
            | Literal["server"]
            | Literal["span"]
            | Literal["task"]
            | Literal["tool"]
            | Literal["unknown"]
            | Literal["workflow"]
        ):
            type_type_0 = cast(Literal["span"], data)
            if type_type_0 != "span":
                raise ValueError(f"type_type_0 must match const 'span', got '{type_type_0}'")
            return type_type_0
            type_type_1 = cast(Literal["llm"], data)
            if type_type_1 != "llm":
                raise ValueError(f"type_type_1 must match const 'llm', got '{type_type_1}'")
            return type_type_1
            type_type_2 = cast(Literal["chain"], data)
            if type_type_2 != "chain":
                raise ValueError(f"type_type_2 must match const 'chain', got '{type_type_2}'")
            return type_type_2
            type_type_3 = cast(Literal["tool"], data)
            if type_type_3 != "tool":
                raise ValueError(f"type_type_3 must match const 'tool', got '{type_type_3}'")
            return type_type_3
            type_type_4 = cast(Literal["agent"], data)
            if type_type_4 != "agent":
                raise ValueError(f"type_type_4 must match const 'agent', got '{type_type_4}'")
            return type_type_4
            type_type_5 = cast(Literal["rag"], data)
            if type_type_5 != "rag":
                raise ValueError(f"type_type_5 must match const 'rag', got '{type_type_5}'")
            return type_type_5
            type_type_6 = cast(Literal["guardrail"], data)
            if type_type_6 != "guardrail":
                raise ValueError(f"type_type_6 must match const 'guardrail', got '{type_type_6}'")
            return type_type_6
            type_type_7 = cast(Literal["evaluation"], data)
            if type_type_7 != "evaluation":
                raise ValueError(f"type_type_7 must match const 'evaluation', got '{type_type_7}'")
            return type_type_7
            type_type_8 = cast(Literal["workflow"], data)
            if type_type_8 != "workflow":
                raise ValueError(f"type_type_8 must match const 'workflow', got '{type_type_8}'")
            return type_type_8
            type_type_9 = cast(Literal["component"], data)
            if type_type_9 != "component":
                raise ValueError(f"type_type_9 must match const 'component', got '{type_type_9}'")
            return type_type_9
            type_type_10 = cast(Literal["module"], data)
            if type_type_10 != "module":
                raise ValueError(f"type_type_10 must match const 'module', got '{type_type_10}'")
            return type_type_10
            type_type_11 = cast(Literal["server"], data)
            if type_type_11 != "server":
                raise ValueError(f"type_type_11 must match const 'server', got '{type_type_11}'")
            return type_type_11
            type_type_12 = cast(Literal["client"], data)
            if type_type_12 != "client":
                raise ValueError(f"type_type_12 must match const 'client', got '{type_type_12}'")
            return type_type_12
            type_type_13 = cast(Literal["producer"], data)
            if type_type_13 != "producer":
                raise ValueError(f"type_type_13 must match const 'producer', got '{type_type_13}'")
            return type_type_13
            type_type_14 = cast(Literal["consumer"], data)
            if type_type_14 != "consumer":
                raise ValueError(f"type_type_14 must match const 'consumer', got '{type_type_14}'")
            return type_type_14
            type_type_15 = cast(Literal["task"], data)
            if type_type_15 != "task":
                raise ValueError(f"type_type_15 must match const 'task', got '{type_type_15}'")
            return type_type_15
            type_type_16 = cast(Literal["unknown"], data)
            if type_type_16 != "unknown":
                raise ValueError(f"type_type_16 must match const 'unknown', got '{type_type_16}'")
            return type_type_16

        type_ = _parse_type_(d.pop("type"))

        timestamps = TraceSpansItemType2Timestamps.from_dict(d.pop("timestamps"))

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

        def _parse_error(data: object) -> None | TraceSpansItemType2ErrorType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = TraceSpansItemType2ErrorType0.from_dict(data)

                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TraceSpansItemType2ErrorType0 | Unset, data)

        error = _parse_error(d.pop("error", UNSET))

        def _parse_metrics(data: object) -> None | TraceSpansItemType2MetricsType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metrics_type_0 = TraceSpansItemType2MetricsType0.from_dict(data)

                return metrics_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TraceSpansItemType2MetricsType0 | Unset, data)

        metrics = _parse_metrics(d.pop("metrics", UNSET))

        def _parse_params(data: object) -> None | TraceSpansItemType2ParamsType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                params_type_0 = TraceSpansItemType2ParamsType0.from_dict(data)

                return params_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TraceSpansItemType2ParamsType0 | Unset, data)

        params = _parse_params(d.pop("params", UNSET))

        trace_spans_item_type_2 = cls(
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
        )

        trace_spans_item_type_2.additional_properties = d
        return trace_spans_item_type_2

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
