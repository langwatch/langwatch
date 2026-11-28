import type { StaffAccessRepositories } from "../staff-access.repositories.ts";
import { MemoryStaffAccessChallengeRepository } from "./memory.staff-access-challenge.repository.ts";
import { MemoryStaffAccessCopyLedgerRepository } from "./memory.staff-access-copy-ledger.repository.ts";
import { MemoryStaffAccessEventRepository } from "./memory.staff-access-event.repository.ts";
import { MemoryStaffAccessRequestRepository } from "./memory.staff-access-request.repository.ts";
import { MemoryStaffAccessRequesterRepository } from "./memory.staff-access-requester.repository.ts";

export class MemoryStaffAccessRepositories {
  static readonly requires = [] as const;

  static create(): StaffAccessRepositories {
    return {
      requesters: MemoryStaffAccessRequesterRepository.create(),
      challenges: MemoryStaffAccessChallengeRepository.create(),
      requests: MemoryStaffAccessRequestRepository.create(),
      events: MemoryStaffAccessEventRepository.create(),
      copyLedger: MemoryStaffAccessCopyLedgerRepository.create(),
    };
  }
}
