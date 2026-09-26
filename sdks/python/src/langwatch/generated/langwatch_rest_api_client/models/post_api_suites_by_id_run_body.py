from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_suites_by_id_run_body_parameters import PostApiSuitesByIdRunBodyParameters
    from ..models.post_api_suites_by_id_run_body_targets_item import PostApiSuitesByIdRunBodyTargetsItem


T = TypeVar("T", bound="PostApiSuitesByIdRunBody")


@_attrs_define
class PostApiSuitesByIdRunBody:
    """
    Attributes:
        idempotency_key (str | Unset):
        targets (list[PostApiSuitesByIdRunBodyTargetsItem] | Unset): The prompts, agents or workflows the run goes
            against. Read only when the id names a test suite, which stores no target of its own; a run plan already holds
            its own and refuses these.
        parameters (PostApiSuitesByIdRunBodyParameters | Unset): Constant values applied to every scenario in the run,
            e.g. a fixture id or a tenant. A value supplied here overrides the scenario's own default for that name.
        note (str | Unset): One short line describing why this batch was run, e.g. a commit hash or what you changed. It
            is stored on every run of the batch and shown beside the run in the platform. Up to 200 characters.
    """

    idempotency_key: str | Unset = UNSET
    targets: list[PostApiSuitesByIdRunBodyTargetsItem] | Unset = UNSET
    parameters: PostApiSuitesByIdRunBodyParameters | Unset = UNSET
    note: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        idempotency_key = self.idempotency_key

        targets: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.targets, Unset):
            targets = []
            for targets_item_data in self.targets:
                targets_item = targets_item_data.to_dict()
                targets.append(targets_item)

        parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = self.parameters.to_dict()

        note = self.note

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if idempotency_key is not UNSET:
            field_dict["idempotencyKey"] = idempotency_key
        if targets is not UNSET:
            field_dict["targets"] = targets
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if note is not UNSET:
            field_dict["note"] = note

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_suites_by_id_run_body_parameters import PostApiSuitesByIdRunBodyParameters
        from ..models.post_api_suites_by_id_run_body_targets_item import PostApiSuitesByIdRunBodyTargetsItem

        d = dict(src_dict)
        idempotency_key = d.pop("idempotencyKey", UNSET)

        _targets = d.pop("targets", UNSET)
        targets: list[PostApiSuitesByIdRunBodyTargetsItem] | Unset = UNSET
        if _targets is not UNSET:
            targets = []
            for targets_item_data in _targets:
                targets_item = PostApiSuitesByIdRunBodyTargetsItem.from_dict(targets_item_data)

                targets.append(targets_item)

        _parameters = d.pop("parameters", UNSET)
        parameters: PostApiSuitesByIdRunBodyParameters | Unset
        if isinstance(_parameters, Unset):
            parameters = UNSET
        else:
            parameters = PostApiSuitesByIdRunBodyParameters.from_dict(_parameters)

        note = d.pop("note", UNSET)

        post_api_suites_by_id_run_body = cls(
            idempotency_key=idempotency_key,
            targets=targets,
            parameters=parameters,
            note=note,
        )

        post_api_suites_by_id_run_body.additional_properties = d
        return post_api_suites_by_id_run_body

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
