from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.evaluation import Evaluation
    from ..models.input_ import Input
    from ..models.metadata import Metadata
    from ..models.metrics import Metrics
    from ..models.output import Output
    from ..models.timestamps import Timestamps
    from ..models.trace_error_type_0 import TraceErrorType0
    from ..models.trace_events_item import TraceEventsItem
    from ..models.trace_expected_output import TraceExpectedOutput
    from ..models.trace_privacy import TracePrivacy
    from ..models.trace_spans_item_type_0 import TraceSpansItemType0
    from ..models.trace_spans_item_type_1 import TraceSpansItemType1
    from ..models.trace_spans_item_type_2 import TraceSpansItemType2


T = TypeVar("T", bound="GetApiTraceIdResponse200")


@_attrs_define
class GetApiTraceIdResponse200:
    """
    Attributes:
        spans (list[TraceSpansItemType0 | TraceSpansItemType1 | TraceSpansItemType2]):
        ascii_tree (str):
        trace_id (str | Unset):
        project_id (str | Unset):
        metadata (Metadata | Unset):
        privacy (TracePrivacy | Unset):
        timestamps (Timestamps | Unset):
        input_ (Input | Unset):
        output (Output | Unset):
        contexts (list[Any] | Unset):
        expected_output (TraceExpectedOutput | Unset):
        metrics (Metrics | Unset):
        error (None | TraceErrorType0 | Unset):
        indexing_md5s (list[str] | Unset):
        events (list[TraceEventsItem] | Unset):
        evaluations (list[Evaluation] | Unset):
        redacted_by_visibility_window (bool | Unset):
    """

    spans: list[TraceSpansItemType0 | TraceSpansItemType1 | TraceSpansItemType2]
    ascii_tree: str
    trace_id: str | Unset = UNSET
    project_id: str | Unset = UNSET
    metadata: Metadata | Unset = UNSET
    privacy: TracePrivacy | Unset = UNSET
    timestamps: Timestamps | Unset = UNSET
    input_: Input | Unset = UNSET
    output: Output | Unset = UNSET
    contexts: list[Any] | Unset = UNSET
    expected_output: TraceExpectedOutput | Unset = UNSET
    metrics: Metrics | Unset = UNSET
    error: None | TraceErrorType0 | Unset = UNSET
    indexing_md5s: list[str] | Unset = UNSET
    events: list[TraceEventsItem] | Unset = UNSET
    evaluations: list[Evaluation] | Unset = UNSET
    redacted_by_visibility_window: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.trace_error_type_0 import TraceErrorType0
        from ..models.trace_spans_item_type_0 import TraceSpansItemType0
        from ..models.trace_spans_item_type_1 import TraceSpansItemType1

        spans = []
        for spans_item_data in self.spans:
            spans_item: dict[str, Any]
            if isinstance(spans_item_data, TraceSpansItemType0):
                spans_item = spans_item_data.to_dict()
            elif isinstance(spans_item_data, TraceSpansItemType1):
                spans_item = spans_item_data.to_dict()
            else:
                spans_item = spans_item_data.to_dict()

            spans.append(spans_item)

        ascii_tree = self.ascii_tree

        trace_id = self.trace_id

        project_id = self.project_id

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        privacy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.privacy, Unset):
            privacy = self.privacy.to_dict()

        timestamps: dict[str, Any] | Unset = UNSET
        if not isinstance(self.timestamps, Unset):
            timestamps = self.timestamps.to_dict()

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        output: dict[str, Any] | Unset = UNSET
        if not isinstance(self.output, Unset):
            output = self.output.to_dict()

        contexts: list[Any] | Unset = UNSET
        if not isinstance(self.contexts, Unset):
            contexts = self.contexts

        expected_output: dict[str, Any] | Unset = UNSET
        if not isinstance(self.expected_output, Unset):
            expected_output = self.expected_output.to_dict()

        metrics: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metrics, Unset):
            metrics = self.metrics.to_dict()

        error: dict[str, Any] | None | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        elif isinstance(self.error, TraceErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        indexing_md5s: list[str] | Unset = UNSET
        if not isinstance(self.indexing_md5s, Unset):
            indexing_md5s = self.indexing_md5s

        events: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.events, Unset):
            events = []
            for events_item_data in self.events:
                events_item = events_item_data.to_dict()
                events.append(events_item)

        evaluations: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evaluations, Unset):
            evaluations = []
            for evaluations_item_data in self.evaluations:
                evaluations_item = evaluations_item_data.to_dict()
                evaluations.append(evaluations_item)

        redacted_by_visibility_window = self.redacted_by_visibility_window

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "spans": spans,
                "ascii_tree": ascii_tree,
            }
        )
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if project_id is not UNSET:
            field_dict["project_id"] = project_id
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if privacy is not UNSET:
            field_dict["privacy"] = privacy
        if timestamps is not UNSET:
            field_dict["timestamps"] = timestamps
        if input_ is not UNSET:
            field_dict["input"] = input_
        if output is not UNSET:
            field_dict["output"] = output
        if contexts is not UNSET:
            field_dict["contexts"] = contexts
        if expected_output is not UNSET:
            field_dict["expected_output"] = expected_output
        if metrics is not UNSET:
            field_dict["metrics"] = metrics
        if error is not UNSET:
            field_dict["error"] = error
        if indexing_md5s is not UNSET:
            field_dict["indexing_md5s"] = indexing_md5s
        if events is not UNSET:
            field_dict["events"] = events
        if evaluations is not UNSET:
            field_dict["evaluations"] = evaluations
        if redacted_by_visibility_window is not UNSET:
            field_dict["redacted_by_visibility_window"] = redacted_by_visibility_window

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.evaluation import Evaluation
        from ..models.input_ import Input
        from ..models.metadata import Metadata
        from ..models.metrics import Metrics
        from ..models.output import Output
        from ..models.timestamps import Timestamps
        from ..models.trace_error_type_0 import TraceErrorType0
        from ..models.trace_events_item import TraceEventsItem
        from ..models.trace_expected_output import TraceExpectedOutput
        from ..models.trace_privacy import TracePrivacy
        from ..models.trace_spans_item_type_0 import TraceSpansItemType0
        from ..models.trace_spans_item_type_1 import TraceSpansItemType1
        from ..models.trace_spans_item_type_2 import TraceSpansItemType2

        d = dict(src_dict)
        spans = []
        _spans = d.pop("spans")
        for spans_item_data in _spans:

            def _parse_spans_item(data: object) -> TraceSpansItemType0 | TraceSpansItemType1 | TraceSpansItemType2:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    spans_item_type_0 = TraceSpansItemType0.from_dict(data)

                    return spans_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    spans_item_type_1 = TraceSpansItemType1.from_dict(data)

                    return spans_item_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                spans_item_type_2 = TraceSpansItemType2.from_dict(data)

                return spans_item_type_2

            spans_item = _parse_spans_item(spans_item_data)

            spans.append(spans_item)

        ascii_tree = d.pop("ascii_tree")

        trace_id = d.pop("trace_id", UNSET)

        project_id = d.pop("project_id", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: Metadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = Metadata.from_dict(_metadata)

        _privacy = d.pop("privacy", UNSET)
        privacy: TracePrivacy | Unset
        if isinstance(_privacy, Unset):
            privacy = UNSET
        else:
            privacy = TracePrivacy.from_dict(_privacy)

        _timestamps = d.pop("timestamps", UNSET)
        timestamps: Timestamps | Unset
        if isinstance(_timestamps, Unset):
            timestamps = UNSET
        else:
            timestamps = Timestamps.from_dict(_timestamps)

        _input_ = d.pop("input", UNSET)
        input_: Input | Unset
        if isinstance(_input_, Unset):
            input_ = UNSET
        else:
            input_ = Input.from_dict(_input_)

        _output = d.pop("output", UNSET)
        output: Output | Unset
        if isinstance(_output, Unset):
            output = UNSET
        else:
            output = Output.from_dict(_output)

        contexts = cast(list[Any], d.pop("contexts", UNSET))

        _expected_output = d.pop("expected_output", UNSET)
        expected_output: TraceExpectedOutput | Unset
        if isinstance(_expected_output, Unset):
            expected_output = UNSET
        else:
            expected_output = TraceExpectedOutput.from_dict(_expected_output)

        _metrics = d.pop("metrics", UNSET)
        metrics: Metrics | Unset
        if isinstance(_metrics, Unset):
            metrics = UNSET
        else:
            metrics = Metrics.from_dict(_metrics)

        def _parse_error(data: object) -> None | TraceErrorType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = TraceErrorType0.from_dict(data)

                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TraceErrorType0 | Unset, data)

        error = _parse_error(d.pop("error", UNSET))

        indexing_md5s = cast(list[str], d.pop("indexing_md5s", UNSET))

        _events = d.pop("events", UNSET)
        events: list[TraceEventsItem] | Unset = UNSET
        if _events is not UNSET:
            events = []
            for events_item_data in _events:
                events_item = TraceEventsItem.from_dict(events_item_data)

                events.append(events_item)

        _evaluations = d.pop("evaluations", UNSET)
        evaluations: list[Evaluation] | Unset = UNSET
        if _evaluations is not UNSET:
            evaluations = []
            for evaluations_item_data in _evaluations:
                evaluations_item = Evaluation.from_dict(evaluations_item_data)

                evaluations.append(evaluations_item)

        redacted_by_visibility_window = d.pop("redacted_by_visibility_window", UNSET)

        get_api_trace_id_response_200 = cls(
            spans=spans,
            ascii_tree=ascii_tree,
            trace_id=trace_id,
            project_id=project_id,
            metadata=metadata,
            privacy=privacy,
            timestamps=timestamps,
            input_=input_,
            output=output,
            contexts=contexts,
            expected_output=expected_output,
            metrics=metrics,
            error=error,
            indexing_md5s=indexing_md5s,
            events=events,
            evaluations=evaluations,
            redacted_by_visibility_window=redacted_by_visibility_window,
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
