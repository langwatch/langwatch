from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_evaluations_by_evaluator_evaluate_response_400_meta import (
        PostApiEvaluationsByEvaluatorEvaluateResponse400Meta,
    )


T = TypeVar("T", bound="PostApiEvaluationsByEvaluatorEvaluateResponse400")


@_attrs_define
class PostApiEvaluationsByEvaluatorEvaluateResponse400:
    """
    Attributes:
        error (str): The failure, as a sentence
        kind (str | Unset): Stable failure code, on the failures that carry one
        meta (PostApiEvaluationsByEvaluatorEvaluateResponse400Meta | Unset): What the code needs to be acted on, such as
            the missing field
    """

    error: str
    kind: str | Unset = UNSET
    meta: PostApiEvaluationsByEvaluatorEvaluateResponse400Meta | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        kind = self.kind

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}

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
        from ..models.post_api_evaluations_by_evaluator_evaluate_response_400_meta import (
            PostApiEvaluationsByEvaluatorEvaluateResponse400Meta,
        )

        d = dict(src_dict)
        error = d.pop("error")

        kind = d.pop("kind", UNSET)

        _meta = d.pop("meta", UNSET)
        meta: PostApiEvaluationsByEvaluatorEvaluateResponse400Meta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = PostApiEvaluationsByEvaluatorEvaluateResponse400Meta.from_dict(_meta)

        post_api_evaluations_by_evaluator_evaluate_response_400 = cls(
            error=error,
            kind=kind,
            meta=meta,
        )

        return post_api_evaluations_by_evaluator_evaluate_response_400
