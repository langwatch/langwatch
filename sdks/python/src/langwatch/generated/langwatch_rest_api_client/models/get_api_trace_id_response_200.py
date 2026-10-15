from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.evaluation import Evaluation
    from ..models.get_api_trace_id_response_200_contexts_item import GetApiTraceIdResponse200ContextsItem
    from ..models.get_api_trace_id_response_200_error_type_0 import GetApiTraceIdResponse200ErrorType0
    from ..models.get_api_trace_id_response_200_events_item import GetApiTraceIdResponse200EventsItem
    from ..models.get_api_trace_id_response_200_expected_output import GetApiTraceIdResponse200ExpectedOutput
    from ..models.get_api_trace_id_response_200_privacy import GetApiTraceIdResponse200Privacy
    from ..models.get_api_trace_id_response_200_spans_item_type_0 import GetApiTraceIdResponse200SpansItemType0
    from ..models.get_api_trace_id_response_200_spans_item_type_1 import GetApiTraceIdResponse200SpansItemType1
    from ..models.get_api_trace_id_response_200_spans_item_type_2 import GetApiTraceIdResponse200SpansItemType2
    from ..models.input_ import Input
    from ..models.metadata import Metadata
    from ..models.metrics import Metrics
    from ..models.output import Output
    from ..models.timestamps import Timestamps


T = TypeVar("T", bound="GetApiTraceIdResponse200")


@_attrs_define
class GetApiTraceIdResponse200:
    """
    Attributes:
        trace_id (str):
        project_id (str):
        metadata (Metadata):
        timestamps (Timestamps):
        spans (list[GetApiTraceIdResponse200SpansItemType0 | GetApiTraceIdResponse200SpansItemType1 |
            GetApiTraceIdResponse200SpansItemType2]):
        ascii_tree (str):
        privacy (GetApiTraceIdResponse200Privacy | Unset):
        input_ (Input | Unset):
        output (Output | Unset):
        contexts (list[GetApiTraceIdResponse200ContextsItem] | Unset):
        expected_output (GetApiTraceIdResponse200ExpectedOutput | Unset):
        metrics (Metrics | Unset):
        error (GetApiTraceIdResponse200ErrorType0 | None | Unset):
        indexing_md5s (list[str] | Unset):
        events (list[GetApiTraceIdResponse200EventsItem] | Unset):
        evaluations (list[Evaluation] | Unset):
        redacted_by_visibility_window (bool | Unset):
    """

    trace_id: str
    project_id: str
    metadata: Metadata
    timestamps: Timestamps
    spans: list[
        GetApiTraceIdResponse200SpansItemType0
        | GetApiTraceIdResponse200SpansItemType1
        | GetApiTraceIdResponse200SpansItemType2
    ]
    ascii_tree: str
    privacy: GetApiTraceIdResponse200Privacy | Unset = UNSET
    input_: Input | Unset = UNSET
    output: Output | Unset = UNSET
    contexts: list[GetApiTraceIdResponse200ContextsItem] | Unset = UNSET
    expected_output: GetApiTraceIdResponse200ExpectedOutput | Unset = UNSET
    metrics: Metrics | Unset = UNSET
    error: GetApiTraceIdResponse200ErrorType0 | None | Unset = UNSET
    indexing_md5s: list[str] | Unset = UNSET
    events: list[GetApiTraceIdResponse200EventsItem] | Unset = UNSET
    evaluations: list[Evaluation] | Unset = UNSET
    redacted_by_visibility_window: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_api_trace_id_response_200_error_type_0 import GetApiTraceIdResponse200ErrorType0
        from ..models.get_api_trace_id_response_200_spans_item_type_0 import GetApiTraceIdResponse200SpansItemType0
        from ..models.get_api_trace_id_response_200_spans_item_type_1 import GetApiTraceIdResponse200SpansItemType1

        trace_id = self.trace_id

        project_id = self.project_id

        metadata = self.metadata.to_dict()

        timestamps = self.timestamps.to_dict()

        spans = []
        for spans_item_data in self.spans:
            spans_item: dict[str, Any]
            if isinstance(spans_item_data, GetApiTraceIdResponse200SpansItemType0):
                spans_item = spans_item_data.to_dict()
            elif isinstance(spans_item_data, GetApiTraceIdResponse200SpansItemType1):
                spans_item = spans_item_data.to_dict()
            else:
                spans_item = spans_item_data.to_dict()

            spans.append(spans_item)

        ascii_tree = self.ascii_tree

        privacy: dict[str, Any] | Unset = UNSET
        if not isinstance(self.privacy, Unset):
            privacy = self.privacy.to_dict()

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        output: dict[str, Any] | Unset = UNSET
        if not isinstance(self.output, Unset):
            output = self.output.to_dict()

        contexts: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.contexts, Unset):
            contexts = []
            for contexts_item_data in self.contexts:
                contexts_item = contexts_item_data.to_dict()
                contexts.append(contexts_item)

        expected_output: dict[str, Any] | Unset = UNSET
        if not isinstance(self.expected_output, Unset):
            expected_output = self.expected_output.to_dict()

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
                "trace_id": trace_id,
                "project_id": project_id,
                "metadata": metadata,
                "timestamps": timestamps,
                "spans": spans,
                "ascii_tree": ascii_tree,
            }
        )
        if privacy is not UNSET:
            field_dict["privacy"] = privacy
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
        from ..models.get_api_trace_id_response_200_contexts_item import GetApiTraceIdResponse200ContextsItem
        from ..models.get_api_trace_id_response_200_error_type_0 import GetApiTraceIdResponse200ErrorType0
        from ..models.get_api_trace_id_response_200_events_item import GetApiTraceIdResponse200EventsItem
        from ..models.get_api_trace_id_response_200_expected_output import GetApiTraceIdResponse200ExpectedOutput
        from ..models.get_api_trace_id_response_200_privacy import GetApiTraceIdResponse200Privacy
        from ..models.get_api_trace_id_response_200_spans_item_type_0 import GetApiTraceIdResponse200SpansItemType0
        from ..models.get_api_trace_id_response_200_spans_item_type_1 import GetApiTraceIdResponse200SpansItemType1
        from ..models.get_api_trace_id_response_200_spans_item_type_2 import GetApiTraceIdResponse200SpansItemType2
        from ..models.input_ import Input
        from ..models.metadata import Metadata
        from ..models.metrics import Metrics
        from ..models.output import Output
        from ..models.timestamps import Timestamps

        d = dict(src_dict)
        trace_id = d.pop("trace_id")

        project_id = d.pop("project_id")

        metadata = Metadata.from_dict(d.pop("metadata"))

        timestamps = Timestamps.from_dict(d.pop("timestamps"))

        spans = []
        _spans = d.pop("spans")
        for spans_item_data in _spans:

            def _parse_spans_item(
                data: object,
            ) -> (
                GetApiTraceIdResponse200SpansItemType0
                | GetApiTraceIdResponse200SpansItemType1
                | GetApiTraceIdResponse200SpansItemType2
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    spans_item_type_0 = GetApiTraceIdResponse200SpansItemType0.from_dict(data)

                    return spans_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    spans_item_type_1 = GetApiTraceIdResponse200SpansItemType1.from_dict(data)

                    return spans_item_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                spans_item_type_2 = GetApiTraceIdResponse200SpansItemType2.from_dict(data)

                return spans_item_type_2

            spans_item = _parse_spans_item(spans_item_data)

            spans.append(spans_item)

        ascii_tree = d.pop("ascii_tree")

        _privacy = d.pop("privacy", UNSET)
        privacy: GetApiTraceIdResponse200Privacy | Unset
        if isinstance(_privacy, Unset):
            privacy = UNSET
        else:
            privacy = GetApiTraceIdResponse200Privacy.from_dict(_privacy)

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

        _contexts = d.pop("contexts", UNSET)
        contexts: list[GetApiTraceIdResponse200ContextsItem] | Unset = UNSET
        if _contexts is not UNSET:
            contexts = []
            for contexts_item_data in _contexts:
                contexts_item = GetApiTraceIdResponse200ContextsItem.from_dict(contexts_item_data)

                contexts.append(contexts_item)

        _expected_output = d.pop("expected_output", UNSET)
        expected_output: GetApiTraceIdResponse200ExpectedOutput | Unset
        if isinstance(_expected_output, Unset):
            expected_output = UNSET
        else:
            expected_output = GetApiTraceIdResponse200ExpectedOutput.from_dict(_expected_output)

        _metrics = d.pop("metrics", UNSET)
        metrics: Metrics | Unset
        if isinstance(_metrics, Unset):
            metrics = UNSET
        else:
            metrics = Metrics.from_dict(_metrics)

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

        _events = d.pop("events", UNSET)
        events: list[GetApiTraceIdResponse200EventsItem] | Unset = UNSET
        if _events is not UNSET:
            events = []
            for events_item_data in _events:
                events_item = GetApiTraceIdResponse200EventsItem.from_dict(events_item_data)

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
            trace_id=trace_id,
            project_id=project_id,
            metadata=metadata,
            timestamps=timestamps,
            spans=spans,
            ascii_tree=ascii_tree,
            privacy=privacy,
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
