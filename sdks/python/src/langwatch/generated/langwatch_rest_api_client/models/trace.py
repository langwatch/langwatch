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


T = TypeVar("T", bound="Trace")


@_attrs_define
class Trace:
    """
    Attributes:
        trace_id (str | Unset):
        project_id (str | Unset):
        timestamps (Timestamps | Unset):
        input_ (Input | Unset):
        output (Output | Unset):
        metadata (Metadata | Unset):
        metrics (Metrics | Unset):
        indexing_md5s (list[str] | Unset):
        error (None | str | Unset):
        evaluations (list[Evaluation] | Unset):
        contexts (list[Any] | Unset):
    """

    trace_id: str | Unset = UNSET
    project_id: str | Unset = UNSET
    timestamps: Timestamps | Unset = UNSET
    input_: Input | Unset = UNSET
    output: Output | Unset = UNSET
    metadata: Metadata | Unset = UNSET
    metrics: Metrics | Unset = UNSET
    indexing_md5s: list[str] | Unset = UNSET
    error: None | str | Unset = UNSET
    evaluations: list[Evaluation] | Unset = UNSET
    contexts: list[Any] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        trace_id = self.trace_id

        project_id = self.project_id

        timestamps: dict[str, Any] | Unset = UNSET
        if not isinstance(self.timestamps, Unset):
            timestamps = self.timestamps.to_dict()

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        output: dict[str, Any] | Unset = UNSET
        if not isinstance(self.output, Unset):
            output = self.output.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        metrics: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metrics, Unset):
            metrics = self.metrics.to_dict()

        indexing_md5s: list[str] | Unset = UNSET
        if not isinstance(self.indexing_md5s, Unset):
            indexing_md5s = self.indexing_md5s

        error: None | str | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        else:
            error = self.error

        evaluations: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evaluations, Unset):
            evaluations = []
            for evaluations_item_data in self.evaluations:
                evaluations_item = evaluations_item_data.to_dict()
                evaluations.append(evaluations_item)

        contexts: list[Any] | Unset = UNSET
        if not isinstance(self.contexts, Unset):
            contexts = self.contexts

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if project_id is not UNSET:
            field_dict["project_id"] = project_id
        if timestamps is not UNSET:
            field_dict["timestamps"] = timestamps
        if input_ is not UNSET:
            field_dict["input"] = input_
        if output is not UNSET:
            field_dict["output"] = output
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if metrics is not UNSET:
            field_dict["metrics"] = metrics
        if indexing_md5s is not UNSET:
            field_dict["indexing_md5s"] = indexing_md5s
        if error is not UNSET:
            field_dict["error"] = error
        if evaluations is not UNSET:
            field_dict["evaluations"] = evaluations
        if contexts is not UNSET:
            field_dict["contexts"] = contexts

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.evaluation import Evaluation
        from ..models.input_ import Input
        from ..models.metadata import Metadata
        from ..models.metrics import Metrics
        from ..models.output import Output
        from ..models.timestamps import Timestamps

        d = dict(src_dict)
        trace_id = d.pop("trace_id", UNSET)

        project_id = d.pop("project_id", UNSET)

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

        _metadata = d.pop("metadata", UNSET)
        metadata: Metadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = Metadata.from_dict(_metadata)

        _metrics = d.pop("metrics", UNSET)
        metrics: Metrics | Unset
        if isinstance(_metrics, Unset):
            metrics = UNSET
        else:
            metrics = Metrics.from_dict(_metrics)

        indexing_md5s = cast(list[str], d.pop("indexing_md5s", UNSET))

        def _parse_error(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        error = _parse_error(d.pop("error", UNSET))

        _evaluations = d.pop("evaluations", UNSET)
        evaluations: list[Evaluation] | Unset = UNSET
        if _evaluations is not UNSET:
            evaluations = []
            for evaluations_item_data in _evaluations:
                evaluations_item = Evaluation.from_dict(evaluations_item_data)

                evaluations.append(evaluations_item)

        contexts = cast(list[Any], d.pop("contexts", UNSET))

        trace = cls(
            trace_id=trace_id,
            project_id=project_id,
            timestamps=timestamps,
            input_=input_,
            output=output,
            metadata=metadata,
            metrics=metrics,
            indexing_md5s=indexing_md5s,
            error=error,
            evaluations=evaluations,
            contexts=contexts,
        )

        trace.additional_properties = d
        return trace

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
