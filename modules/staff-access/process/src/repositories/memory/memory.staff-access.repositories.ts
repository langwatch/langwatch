import type { StaffAccessRepositories } from "../staff-access.repositories.ts";
import {
  MemoryStaffAccessChallengeRepository,
  MemoryStaffAccessEventRepository,
  MemoryStaffAccessRequestRepository,
  MemoryStaffAccessRequesterRepository,
} from "./memory.staff-access.repository.ts";

export class MemoryStaffAccessRepositories {
  static readonly requires = [] as const;

  static create(): StaffAccessRepositories {
    return {
      requesters: MemoryStaffAccessRequesterRepository.create(),
      challenges: MemoryStaffAccessChallengeRepository.create(),
      requests: MemoryStaffAccessRequestRepository.create(),
      events: MemoryStaffAccessEventRepository.create(),
    };
  }
}
