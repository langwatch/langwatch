/**
 * Test-only: the free budget a run start checks, over a peer's real ledger read, for a suite
 * that writes the ledger rows itself. Application code reaches it only through the module.
 */
import { MemoryInstantEvalBudgetReservationsRepository } from "../repositories/memory/memory.instant-eval-budget-reservations.repository.ts";
import { InstantEvalFreeBudgetService } from "../services/instant-eval-free-budget.service.ts";

type InstantEvalBudgetPeers = Parameters<typeof InstantEvalFreeBudgetService.create>[0]["peers"];

export type InstantEvalRunStartBudget = Pick<InstantEvalFreeBudgetService, "assertWithinBudget">;

/** The check `InstantEvalRunService.createRun` makes before a run is accepted, with no holds taken. */
export function instantEvalRunStartBudgetOver({
  peers,
}: {
  peers: InstantEvalBudgetPeers;
}): InstantEvalRunStartBudget {
  return InstantEvalFreeBudgetService.create({
    peers,
    reservations: MemoryInstantEvalBudgetReservationsRepository.create(),
  });
}
