from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_instant_eval_run_response_200_questions_item_kind import GetInstantEvalRunResponse200QuestionsItemKind

T = TypeVar("T", bound="GetInstantEvalRunResponse200QuestionsItem")


@_attrs_define
class GetInstantEvalRunResponse200QuestionsItem:
    """
    Attributes:
        id (str): The statement's own output column, which is the name this question is addressed by everywhere else.
        function (str): The eval function that asked it.
        kind (GetInstantEvalRunResponse200QuestionsItemKind): What kind of answer the question takes.
        reads (str): Which part of the verdict the statement's column carries.
        threshold (float | None): Where a boolean question's probability becomes a pass. Null for a question that is not
            a boolean.
    """

    id: str
    function: str
    kind: GetInstantEvalRunResponse200QuestionsItemKind
    reads: str
    threshold: float | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        function = self.function

        kind = self.kind.value

        reads = self.reads

        threshold: float | None
        threshold = self.threshold

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        kind = GetInstantEvalRunResponse200QuestionsItemKind(d.pop("kind"))

        reads = d.pop("reads")

        def _parse_threshold(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        threshold = _parse_threshold(d.pop("threshold"))

        get_instant_eval_run_response_200_questions_item = cls(
            id=id,
            function=function,
            kind=kind,
            reads=reads,
            threshold=threshold,
        )

        get_instant_eval_run_response_200_questions_item.additional_properties = d
        return get_instant_eval_run_response_200_questions_item

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
