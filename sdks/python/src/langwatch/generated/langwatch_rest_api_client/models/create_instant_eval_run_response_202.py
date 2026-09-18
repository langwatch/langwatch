from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.create_instant_eval_run_response_202_status import CreateInstantEvalRunResponse202Status

if TYPE_CHECKING:
    from ..models.create_instant_eval_run_response_202_matched_by_question import (
        CreateInstantEvalRunResponse202MatchedByQuestion,
    )
    from ..models.create_instant_eval_run_response_202_parameters import CreateInstantEvalRunResponse202Parameters
    from ..models.create_instant_eval_run_response_202_questions_item import (
        CreateInstantEvalRunResponse202QuestionsItem,
    )


T = TypeVar("T", bound="CreateInstantEvalRunResponse202")


@_attrs_define
class CreateInstantEvalRunResponse202:
    """
    Attributes:
        id (str): The run id.
        name (None | str): What the run was called, if anything.
        sql (str): The statement, exactly as submitted.
        parameters (CreateInstantEvalRunResponse202Parameters): The values the statement's parameters were filled with.
        questions (list[CreateInstantEvalRunResponse202QuestionsItem]): One entry per eval function the statement
            projects, derived from it when the run was accepted.
        limit (int): Rows this run may judge.
        status (CreateInstantEvalRunResponse202Status): Where the run is in its life.
        total (int | None): Rows the run found, bounded by its limit. Null until it has looked.
        progress (int): Rows judged so far.
        matched (int | None): Judgements that matched, across this run's boolean questions. Null when the run asked
            none: a score or a category question has no match to count.
        matched_by_question (CreateInstantEvalRunResponse202MatchedByQuestion): Per question: matches for a boolean
            question, judged rows for a score or a category one.
        failed (int): Rows the judge could not answer.
        skipped (int): Rows the judge declined to answer.
        tokens (int): Input tokens the judge billed for.
        cost_usd (float): What the judging cost us, in United States dollars.
        price_usd (float): What the judging costs you, in United States dollars.
        error (None | str): The code of the failure that ended the run, when one did.
        created_at (str): When the run was accepted.
        updated_at (str): When the run was last written to.
        started_at (None | str): When the run began reading rows.
        finished_at (None | str): When the run ended.
    """

    id: str
    name: None | str
    sql: str
    parameters: CreateInstantEvalRunResponse202Parameters
    questions: list[CreateInstantEvalRunResponse202QuestionsItem]
    limit: int
    status: CreateInstantEvalRunResponse202Status
    total: int | None
    progress: int
    matched: int | None
    matched_by_question: CreateInstantEvalRunResponse202MatchedByQuestion
    failed: int
    skipped: int
    tokens: int
    cost_usd: float
    price_usd: float
    error: None | str
    created_at: str
    updated_at: str
    started_at: None | str
    finished_at: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name: None | str
        name = self.name

        sql = self.sql

        parameters = self.parameters.to_dict()

        questions = []
        for questions_item_data in self.questions:
            questions_item = questions_item_data.to_dict()
            questions.append(questions_item)

        limit = self.limit

        status = self.status.value

        total: int | None
        total = self.total

        progress = self.progress

        matched: int | None
        matched = self.matched

        matched_by_question = self.matched_by_question.to_dict()

        failed = self.failed

        skipped = self.skipped

        tokens = self.tokens

        cost_usd = self.cost_usd

        price_usd = self.price_usd

        error: None | str
        error = self.error

        created_at = self.created_at

        updated_at = self.updated_at

        started_at: None | str
        started_at = self.started_at

        finished_at: None | str
        finished_at = self.finished_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "sql": sql,
                "parameters": parameters,
                "questions": questions,
                "limit": limit,
                "status": status,
                "total": total,
                "progress": progress,
                "matched": matched,
                "matchedByQuestion": matched_by_question,
                "failed": failed,
                "skipped": skipped,
                "tokens": tokens,
                "costUsd": cost_usd,
                "priceUsd": price_usd,
                "error": error,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "startedAt": started_at,
                "finishedAt": finished_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_instant_eval_run_response_202_matched_by_question import (
            CreateInstantEvalRunResponse202MatchedByQuestion,
        )
        from ..models.create_instant_eval_run_response_202_parameters import CreateInstantEvalRunResponse202Parameters
        from ..models.create_instant_eval_run_response_202_questions_item import (
            CreateInstantEvalRunResponse202QuestionsItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        sql = d.pop("sql")

        parameters = CreateInstantEvalRunResponse202Parameters.from_dict(d.pop("parameters"))

        questions = []
        _questions = d.pop("questions")
        for questions_item_data in _questions:
            questions_item = CreateInstantEvalRunResponse202QuestionsItem.from_dict(questions_item_data)

            questions.append(questions_item)

        limit = d.pop("limit")

        status = CreateInstantEvalRunResponse202Status(d.pop("status"))

        def _parse_total(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        total = _parse_total(d.pop("total"))

        progress = d.pop("progress")

        def _parse_matched(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        matched = _parse_matched(d.pop("matched"))

        matched_by_question = CreateInstantEvalRunResponse202MatchedByQuestion.from_dict(d.pop("matchedByQuestion"))

        failed = d.pop("failed")

        skipped = d.pop("skipped")

        tokens = d.pop("tokens")

        cost_usd = d.pop("costUsd")

        price_usd = d.pop("priceUsd")

        def _parse_error(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error = _parse_error(d.pop("error"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        def _parse_started_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        started_at = _parse_started_at(d.pop("startedAt"))

        def _parse_finished_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        finished_at = _parse_finished_at(d.pop("finishedAt"))

        create_instant_eval_run_response_202 = cls(
            id=id,
            name=name,
            sql=sql,
            parameters=parameters,
            questions=questions,
            limit=limit,
            status=status,
            total=total,
            progress=progress,
            matched=matched,
            matched_by_question=matched_by_question,
            failed=failed,
            skipped=skipped,
            tokens=tokens,
            cost_usd=cost_usd,
            price_usd=price_usd,
            error=error,
            created_at=created_at,
            updated_at=updated_at,
            started_at=started_at,
            finished_at=finished_at,
        )

        create_instant_eval_run_response_202.additional_properties = d
        return create_instant_eval_run_response_202

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
