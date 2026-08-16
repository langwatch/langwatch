from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_evaluations_by_evaluator_evaluate_body_data import (
        PostApiEvaluationsByEvaluatorEvaluateBodyData,
    )
    from ..models.post_api_evaluations_by_evaluator_evaluate_body_settings import (
        PostApiEvaluationsByEvaluatorEvaluateBodySettings,
    )


T = TypeVar("T", bound="PostApiEvaluationsByEvaluatorEvaluateBody")


@_attrs_define
class PostApiEvaluationsByEvaluatorEvaluateBody:
    """
    Attributes:
        data (PostApiEvaluationsByEvaluatorEvaluateBodyData): What the evaluator scores. Which fields are required
            depends on the evaluator; its own entry under Built-in Evaluators lists them.
        settings (PostApiEvaluationsByEvaluatorEvaluateBodySettings | Unset): Per-call overrides of the evaluator's
            settings. Anything omitted falls back to the saved evaluator or monitor, then to the evaluator's own defaults.
        trace_id (None | str | Unset): Attaches the result to a trace you already sent
        evaluation_id (None | str | Unset): Supply your own id to make the call idempotent
        evaluator_id (None | str | Unset):
        name (None | str | Unset): Overrides the name the result is recorded under
        as_guardrail (bool | None | Unset): Evaluate as a guardrail: a skipped or failed evaluation answers `passed`
            rather than an error, so a caller can gate on one field. The /api/guardrails path sets this for you.
    """

    data: PostApiEvaluationsByEvaluatorEvaluateBodyData
    settings: PostApiEvaluationsByEvaluatorEvaluateBodySettings | Unset = UNSET
    trace_id: None | str | Unset = UNSET
    evaluation_id: None | str | Unset = UNSET
    evaluator_id: None | str | Unset = UNSET
    name: None | str | Unset = UNSET
    as_guardrail: bool | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        data = self.data.to_dict()

        settings: dict[str, Any] | Unset = UNSET
        if not isinstance(self.settings, Unset):
            settings = self.settings.to_dict()

        trace_id: None | str | Unset
        if isinstance(self.trace_id, Unset):
            trace_id = UNSET
        else:
            trace_id = self.trace_id

        evaluation_id: None | str | Unset
        if isinstance(self.evaluation_id, Unset):
            evaluation_id = UNSET
        else:
            evaluation_id = self.evaluation_id

        evaluator_id: None | str | Unset
        if isinstance(self.evaluator_id, Unset):
            evaluator_id = UNSET
        else:
            evaluator_id = self.evaluator_id

        name: None | str | Unset
        if isinstance(self.name, Unset):
            name = UNSET
        else:
            name = self.name

        as_guardrail: bool | None | Unset
        if isinstance(self.as_guardrail, Unset):
            as_guardrail = UNSET
        else:
            as_guardrail = self.as_guardrail

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "data": data,
            }
        )
        if settings is not UNSET:
            field_dict["settings"] = settings
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if evaluation_id is not UNSET:
            field_dict["evaluation_id"] = evaluation_id
        if evaluator_id is not UNSET:
            field_dict["evaluator_id"] = evaluator_id
        if name is not UNSET:
            field_dict["name"] = name
        if as_guardrail is not UNSET:
            field_dict["as_guardrail"] = as_guardrail

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_evaluations_by_evaluator_evaluate_body_data import (
            PostApiEvaluationsByEvaluatorEvaluateBodyData,
        )
        from ..models.post_api_evaluations_by_evaluator_evaluate_body_settings import (
            PostApiEvaluationsByEvaluatorEvaluateBodySettings,
        )

        d = dict(src_dict)
        data = PostApiEvaluationsByEvaluatorEvaluateBodyData.from_dict(d.pop("data"))

        _settings = d.pop("settings", UNSET)
        settings: PostApiEvaluationsByEvaluatorEvaluateBodySettings | Unset
        if isinstance(_settings, Unset):
            settings = UNSET
        else:
            settings = PostApiEvaluationsByEvaluatorEvaluateBodySettings.from_dict(_settings)

        def _parse_trace_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        trace_id = _parse_trace_id(d.pop("trace_id", UNSET))

        def _parse_evaluation_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        evaluation_id = _parse_evaluation_id(d.pop("evaluation_id", UNSET))

        def _parse_evaluator_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        evaluator_id = _parse_evaluator_id(d.pop("evaluator_id", UNSET))

        def _parse_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        name = _parse_name(d.pop("name", UNSET))

        def _parse_as_guardrail(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        as_guardrail = _parse_as_guardrail(d.pop("as_guardrail", UNSET))

        post_api_evaluations_by_evaluator_evaluate_body = cls(
            data=data,
            settings=settings,
            trace_id=trace_id,
            evaluation_id=evaluation_id,
            evaluator_id=evaluator_id,
            name=name,
            as_guardrail=as_guardrail,
        )

        return post_api_evaluations_by_evaluator_evaluate_body
