from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_guardrails_by_evaluator_evaluate_response_404_meta import (
        PostApiGuardrailsByEvaluatorEvaluateResponse404Meta,
    )


T = TypeVar("T", bound="PostApiGuardrailsByEvaluatorEvaluateResponse404")


@_attrs_define
class PostApiGuardrailsByEvaluatorEvaluateResponse404:
    """
    Attributes:
        error (str): The failure, as a sentence
        kind (str | Unset): Stable failure code, on the failures that carry one
        meta (PostApiGuardrailsByEvaluatorEvaluateResponse404Meta | Unset): What the code needs to be acted on, such as
            the missing field
    """

    error: str
    kind: str | Unset = UNSET
    meta: PostApiGuardrailsByEvaluatorEvaluateResponse404Meta | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        kind = self.kind

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
            }
        )
        if kind is not UNSET:
            field_dict["kind"] = kind
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_guardrails_by_evaluator_evaluate_response_404_meta import (
            PostApiGuardrailsByEvaluatorEvaluateResponse404Meta,
        )

        d = dict(src_dict)
        error = d.pop("error")

        kind = d.pop("kind", UNSET)

        _meta = d.pop("meta", UNSET)
        meta: PostApiGuardrailsByEvaluatorEvaluateResponse404Meta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = PostApiGuardrailsByEvaluatorEvaluateResponse404Meta.from_dict(_meta)

        post_api_guardrails_by_evaluator_evaluate_response_404 = cls(
            error=error,
            kind=kind,
            meta=meta,
        )

        post_api_guardrails_by_evaluator_evaluate_response_404.additional_properties = d
        return post_api_guardrails_by_evaluator_evaluate_response_404

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
