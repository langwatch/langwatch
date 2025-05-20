from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

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
        trace_id (Union[Unset, str]):
        project_id (Union[Unset, str]):
        timestamps (Union[Unset, Timestamps]):
        input_ (Union[Unset, Input]):
        output (Union[Unset, Output]):
        metadata (Union[Unset, Metadata]):
        metrics (Union[Unset, Metrics]):
        indexing_md5s (Union[Unset, list[str]]):
        error (Union[None, Unset, str]):
        evaluations (Union[Unset, list['Evaluation']]):
        contexts (Union[Unset, list[Any]]):
    """

    trace_id: Union[Unset, str] = UNSET
    project_id: Union[Unset, str] = UNSET
    timestamps: Union[Unset, "Timestamps"] = UNSET
    input_: Union[Unset, "Input"] = UNSET
    output: Union[Unset, "Output"] = UNSET
    metadata: Union[Unset, "Metadata"] = UNSET
    metrics: Union[Unset, "Metrics"] = UNSET
    indexing_md5s: Union[Unset, list[str]] = UNSET
    error: Union[None, Unset, str] = UNSET
    evaluations: Union[Unset, list["Evaluation"]] = UNSET
    contexts: Union[Unset, list[Any]] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        trace_id = self.trace_id

        project_id = self.project_id

        timestamps: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.timestamps, Unset):
            timestamps = self.timestamps.to_dict()

        input_: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        output: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.output, Unset):
            output = self.output.to_dict()

        metadata: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        metrics: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.metrics, Unset):
            metrics = self.metrics.to_dict()

        indexing_md5s: Union[Unset, list[str]] = UNSET
        if not isinstance(self.indexing_md5s, Unset):
            indexing_md5s = self.indexing_md5s

        error: Union[None, Unset, str]
        if isinstance(self.error, Unset):
            error = UNSET
        else:
            error = self.error

        evaluations: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.evaluations, Unset):
            evaluations = []
            for evaluations_item_data in self.evaluations:
                evaluations_item = evaluations_item_data.to_dict()
                evaluations.append(evaluations_item)

        contexts: Union[Unset, list[Any]] = UNSET
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
        timestamps: Union[Unset, Timestamps]
        if isinstance(_timestamps, Unset):
            timestamps = UNSET
        else:
            timestamps = Timestamps.from_dict(_timestamps)

        _input_ = d.pop("input", UNSET)
        input_: Union[Unset, Input]
        if isinstance(_input_, Unset):
            input_ = UNSET
        else:
            input_ = Input.from_dict(_input_)

        _output = d.pop("output", UNSET)
        output: Union[Unset, Output]
        if isinstance(_output, Unset):
            output = UNSET
        else:
            output = Output.from_dict(_output)

        _metadata = d.pop("metadata", UNSET)
        metadata: Union[Unset, Metadata]
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = Metadata.from_dict(_metadata)

        _metrics = d.pop("metrics", UNSET)
        metrics: Union[Unset, Metrics]
        if isinstance(_metrics, Unset):
            metrics = UNSET
        else:
            metrics = Metrics.from_dict(_metrics)

        indexing_md5s = cast(list[str], d.pop("indexing_md5s", UNSET))

        def _parse_error(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        error = _parse_error(d.pop("error", UNSET))

        evaluations = []
        _evaluations = d.pop("evaluations", UNSET)
        for evaluations_item_data in _evaluations or []:
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
