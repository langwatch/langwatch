from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.estimate_instant_eval_run_body_questions_item_kind import EstimateInstantEvalRunBodyQuestionsItemKind
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.estimate_instant_eval_run_body_questions_item_options_item import (
        EstimateInstantEvalRunBodyQuestionsItemOptionsItem,
    )
    from ..models.estimate_instant_eval_run_body_questions_item_range import (
        EstimateInstantEvalRunBodyQuestionsItemRange,
    )


T = TypeVar("T", bound="EstimateInstantEvalRunBodyQuestionsItem")


@_attrs_define
class EstimateInstantEvalRunBodyQuestionsItem:
    """
    Attributes:
        instructions (str): The question, in your own words, as you would write it for a human reader.
        id (str | Unset): What to call this question. It becomes the statement's output column and the name every
            judgement is filed under. Defaults to q1, q2 and so on.
        kind (EstimateInstantEvalRunBodyQuestionsItemKind | Unset): What kind of answer you want: a yes or no, a rating
            on a scale, or one of a list of options. Default: EstimateInstantEvalRunBodyQuestionsItemKind.BOOLEAN.
        criteria (list[str] | Unset): For a yes or no question: what counts as yes, then what counts as no. Cannot be
            combined with a threshold.
        threshold (float | Unset): For a yes or no question: the probability at or above which the answer counts as yes.
            Without one the column carries the probability itself and a run draws the line at an even chance.
        range_ (EstimateInstantEvalRunBodyQuestionsItemRange | Unset): For a rating: the two ends of the scale.
        options (list[EstimateInstantEvalRunBodyQuestionsItemOptionsItem] | Unset): For a choice: the options to pick
            between.
    """

    instructions: str
    id: str | Unset = UNSET
    kind: EstimateInstantEvalRunBodyQuestionsItemKind | Unset = EstimateInstantEvalRunBodyQuestionsItemKind.BOOLEAN
    criteria: list[str] | Unset = UNSET
    threshold: float | Unset = UNSET
    range_: EstimateInstantEvalRunBodyQuestionsItemRange | Unset = UNSET
    options: list[EstimateInstantEvalRunBodyQuestionsItemOptionsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        instructions = self.instructions

        id = self.id

        kind: str | Unset = UNSET
        if not isinstance(self.kind, Unset):
            kind = self.kind.value

        criteria: list[str] | Unset = UNSET
        if not isinstance(self.criteria, Unset):
            criteria = self.criteria

        threshold = self.threshold

        range_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.range_, Unset):
            range_ = self.range_.to_dict()

        options: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.options, Unset):
            options = []
            for options_item_data in self.options:
                options_item = options_item_data.to_dict()
                options.append(options_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "instructions": instructions,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if kind is not UNSET:
            field_dict["kind"] = kind
        if criteria is not UNSET:
            field_dict["criteria"] = criteria
        if threshold is not UNSET:
            field_dict["threshold"] = threshold
        if range_ is not UNSET:
            field_dict["range"] = range_
        if options is not UNSET:
            field_dict["options"] = options

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.estimate_instant_eval_run_body_questions_item_options_item import (
            EstimateInstantEvalRunBodyQuestionsItemOptionsItem,
        )
        from ..models.estimate_instant_eval_run_body_questions_item_range import (
            EstimateInstantEvalRunBodyQuestionsItemRange,
        )

        d = dict(src_dict)
        instructions = d.pop("instructions")

        id = d.pop("id", UNSET)

        _kind = d.pop("kind", UNSET)
        kind: EstimateInstantEvalRunBodyQuestionsItemKind | Unset
        if isinstance(_kind, Unset):
            kind = UNSET
        else:
            kind = EstimateInstantEvalRunBodyQuestionsItemKind(_kind)

        criteria = cast(list[str], d.pop("criteria", UNSET))

        threshold = d.pop("threshold", UNSET)

        _range_ = d.pop("range", UNSET)
        range_: EstimateInstantEvalRunBodyQuestionsItemRange | Unset
        if isinstance(_range_, Unset):
            range_ = UNSET
        else:
            range_ = EstimateInstantEvalRunBodyQuestionsItemRange.from_dict(_range_)

        _options = d.pop("options", UNSET)
        options: list[EstimateInstantEvalRunBodyQuestionsItemOptionsItem] | Unset = UNSET
        if _options is not UNSET:
            options = []
            for options_item_data in _options:
                options_item = EstimateInstantEvalRunBodyQuestionsItemOptionsItem.from_dict(options_item_data)

                options.append(options_item)

        estimate_instant_eval_run_body_questions_item = cls(
            instructions=instructions,
            id=id,
            kind=kind,
            criteria=criteria,
            threshold=threshold,
            range_=range_,
            options=options,
        )

        estimate_instant_eval_run_body_questions_item.additional_properties = d
        return estimate_instant_eval_run_body_questions_item

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
