from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.create_instant_eval_run_response_202_questions_item_kind import (
    CreateInstantEvalRunResponse202QuestionsItemKind,
)

T = TypeVar("T", bound="CreateInstantEvalRunResponse202QuestionsItem")


@_attrs_define
class CreateInstantEvalRunResponse202QuestionsItem:
    """
    Attributes:
        id (str): The statement's own output column, which is the name this question is addressed by everywhere else.
        function (str): The eval function that asked it.
        kind (CreateInstantEvalRunResponse202QuestionsItemKind): What kind of answer the question takes.
        reads (str): Which part of the verdict the statement's column carries.
        threshold (float | None): Where a boolean question's probability becomes a pass. Null for a question that is not
            a boolean.
    """

    id: str
    function: str
    kind: CreateInstantEvalRunResponse202QuestionsItemKind
    reads: str
    threshold: float | None

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        function = self.function

        kind = self.kind.value

        reads = self.reads

        threshold: float | None
        threshold = self.threshold

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "function": function,
                "kind": kind,
                "reads": reads,
                "threshold": threshold,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        function = d.pop("function")

        kind = CreateInstantEvalRunResponse202QuestionsItemKind(d.pop("kind"))

        reads = d.pop("reads")

        def _parse_threshold(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        threshold = _parse_threshold(d.pop("threshold"))

        create_instant_eval_run_response_202_questions_item = cls(
            id=id,
            function=function,
            kind=kind,
            reads=reads,
            threshold=threshold,
        )

        return create_instant_eval_run_response_202_questions_item
