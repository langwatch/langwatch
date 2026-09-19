from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.create_instant_eval_run_body_target import CreateInstantEvalRunBodyTarget
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_instant_eval_run_body_parameters import CreateInstantEvalRunBodyParameters
    from ..models.create_instant_eval_run_body_questions_item import CreateInstantEvalRunBodyQuestionsItem


T = TypeVar("T", bound="CreateInstantEvalRunBody")


@_attrs_define
class CreateInstantEvalRunBody:
    """
    Attributes:
        sql (str | Unset): The LangWatchQL statement to judge. It must project TraceId and at least one eval function
            column. Send this or target, never both.
        parameters (CreateInstantEvalRunBodyParameters | Unset): Values for the parameters the statement declares.
        target (CreateInstantEvalRunBodyTarget | Unset): What one judged row is, in place of a statement: a trace, a
            conversation, or one model call. The statement is written for you from this and the questions, and handed back
            on the run so you can edit it and resubmit.
        filter_ (str | Unset): With target: a trace filter, in the language the trace explorer's search bar speaks,
            narrowing which rows are judged.
        start (datetime.datetime | Unset): With target: the oldest instant to judge, as an ISO 8601 timestamp. Defaults
            to seven days ago.
        end (datetime.datetime | Unset): With target: the newest instant to judge. Defaults to now.
        questions (list[CreateInstantEvalRunBodyQuestionsItem] | Unset): With target: what to ask of each row. One
            classification asks them all, which is why a three-question run costs about what a one-question run does.
        name (str | Unset): What to call the run. Yours to choose.
        limit (int | Unset): Rows the run may judge. Ten thousand by default on every plan, up to one hundred thousand
            on a plan that lifts the cap.
    """

    sql: str | Unset = UNSET
    parameters: CreateInstantEvalRunBodyParameters | Unset = UNSET
    target: CreateInstantEvalRunBodyTarget | Unset = UNSET
    filter_: str | Unset = UNSET
    start: datetime.datetime | Unset = UNSET
    end: datetime.datetime | Unset = UNSET
    questions: list[CreateInstantEvalRunBodyQuestionsItem] | Unset = UNSET
    name: str | Unset = UNSET
    limit: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        sql = self.sql

        parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = self.parameters.to_dict()

        target: str | Unset = UNSET
        if not isinstance(self.target, Unset):
            target = self.target.value

        filter_ = self.filter_

        start: str | Unset = UNSET
        if not isinstance(self.start, Unset):
            start = self.start.isoformat()

        end: str | Unset = UNSET
        if not isinstance(self.end, Unset):
            end = self.end.isoformat()

        questions: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.questions, Unset):
            questions = []
            for questions_item_data in self.questions:
                questions_item = questions_item_data.to_dict()
                questions.append(questions_item)

        name = self.name

        limit = self.limit

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if sql is not UNSET:
            field_dict["sql"] = sql
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if target is not UNSET:
            field_dict["target"] = target
        if filter_ is not UNSET:
            field_dict["filter"] = filter_
        if start is not UNSET:
            field_dict["start"] = start
        if end is not UNSET:
            field_dict["end"] = end
        if questions is not UNSET:
            field_dict["questions"] = questions
        if name is not UNSET:
            field_dict["name"] = name
        if limit is not UNSET:
            field_dict["limit"] = limit

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_instant_eval_run_body_parameters import CreateInstantEvalRunBodyParameters
        from ..models.create_instant_eval_run_body_questions_item import CreateInstantEvalRunBodyQuestionsItem

        d = dict(src_dict)
        sql = d.pop("sql", UNSET)

        _parameters = d.pop("parameters", UNSET)
        parameters: CreateInstantEvalRunBodyParameters | Unset
        if isinstance(_parameters, Unset):
            parameters = UNSET
        else:
            parameters = CreateInstantEvalRunBodyParameters.from_dict(_parameters)

        _target = d.pop("target", UNSET)
        target: CreateInstantEvalRunBodyTarget | Unset
        if isinstance(_target, Unset):
            target = UNSET
        else:
            target = CreateInstantEvalRunBodyTarget(_target)

        filter_ = d.pop("filter", UNSET)

        _start = d.pop("start", UNSET)
        start: datetime.datetime | Unset
        if isinstance(_start, Unset):
            start = UNSET
        else:
            start = isoparse(_start)

        _end = d.pop("end", UNSET)
        end: datetime.datetime | Unset
        if isinstance(_end, Unset):
            end = UNSET
        else:
            end = isoparse(_end)

        _questions = d.pop("questions", UNSET)
        questions: list[CreateInstantEvalRunBodyQuestionsItem] | Unset = UNSET
        if _questions is not UNSET:
            questions = []
            for questions_item_data in _questions:
                questions_item = CreateInstantEvalRunBodyQuestionsItem.from_dict(questions_item_data)

                questions.append(questions_item)

        name = d.pop("name", UNSET)

        limit = d.pop("limit", UNSET)

        create_instant_eval_run_body = cls(
            sql=sql,
            parameters=parameters,
            target=target,
            filter_=filter_,
            start=start,
            end=end,
            questions=questions,
            name=name,
            limit=limit,
        )

        create_instant_eval_run_body.additional_properties = d
        return create_instant_eval_run_body

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
