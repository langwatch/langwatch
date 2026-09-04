from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_api_experiments_by_slug_workbench_state_body_state import (
        PutApiExperimentsBySlugWorkbenchStateBodyState,
    )


T = TypeVar("T", bound="PutApiExperimentsBySlugWorkbenchStateBody")


@_attrs_define
class PutApiExperimentsBySlugWorkbenchStateBody:
    """
    Attributes:
        state (PutApiExperimentsBySlugWorkbenchStateBodyState): The full setup to save
        expected_version (int | Unset): The version you read. Sending it refuses the save when someone else already
            wrote on top of it.
        commit_message (str | Unset): Names this version in the history list
    """

    state: PutApiExperimentsBySlugWorkbenchStateBodyState
    expected_version: int | Unset = UNSET
    commit_message: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        state = self.state.to_dict()

        expected_version = self.expected_version

        commit_message = self.commit_message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "state": state,
            }
        )
        if expected_version is not UNSET:
            field_dict["expectedVersion"] = expected_version
        if commit_message is not UNSET:
            field_dict["commitMessage"] = commit_message

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_experiments_by_slug_workbench_state_body_state import (
            PutApiExperimentsBySlugWorkbenchStateBodyState,
        )

        d = dict(src_dict)
        state = PutApiExperimentsBySlugWorkbenchStateBodyState.from_dict(d.pop("state"))

        expected_version = d.pop("expectedVersion", UNSET)

        commit_message = d.pop("commitMessage", UNSET)

        put_api_experiments_by_slug_workbench_state_body = cls(
            state=state,
            expected_version=expected_version,
            commit_message=commit_message,
        )

        put_api_experiments_by_slug_workbench_state_body.additional_properties = d
        return put_api_experiments_by_slug_workbench_state_body

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
