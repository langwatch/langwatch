import type {
  StaffAccessChallengeRepository,
  StaffAccessCopyLedgerRepository,
  StaffAccessEventRepository,
  StaffAccessRequestRepository,
  StaffAccessRequesterRepository,
} from "./staff-access.repository.ts";

export type StaffAccessRepositories = Readonly<{
  requesters: StaffAccessRequesterRepository;
  challenges: StaffAccessChallengeRepository;
  requests: StaffAccessRequestRepository;
  events: StaffAccessEventRepository;
  copyLedger: StaffAccessCopyLedgerRepository;
}>;
