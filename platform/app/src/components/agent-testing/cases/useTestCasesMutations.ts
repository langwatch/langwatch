/**
 * Every write the Test cases tab makes, and the dialog state each write needs
 * to close itself when it lands.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/suites/suite-folders.feature
 */

import { useCallback, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import type { AgentTestingSelection } from "../useAgentTestingRouting";
import type { TestCase } from "./test-cases";

function toastOnError(fallbackTitle: string) {
  return (error: unknown) => showErrorToast({ error, fallbackTitle });
}

/** The two reads the rail and the table are drawn from. */
function useCasesInvalidate(projectId: string): () => void {
  const utils = api.useUtils();
  return useCallback(() => {
    void utils.scenarios.getAll.invalidate({ projectId });
    void utils.suites.folders.getAll.invalidate({ projectId });
  }, [utils, projectId]);
}

export type SuiteMutations = {
  isArchiving: boolean;
  createSuite: (name: string) => void;
  archiveSuite: (suiteId: string) => void;
};

export function useSuiteMutations({
  projectId,
  selectedSuiteId,
  selectSuite,
}: {
  projectId: string;
  /** The suite the rail is on, so archiving another one leaves it alone. */
  selectedSuiteId: string | null;
  selectSuite: (selection: AgentTestingSelection) => void;
}): SuiteMutations {
  const invalidate = useCasesInvalidate(projectId);

  const create = api.suites.folders.create.useMutation({
    onSuccess: (folder) => {
      invalidate();
      selectSuite({ kind: "suite", slug: folder.slug });
    },
    onError: toastOnError("Couldn't create the test suite"),
  });

  const archive = api.suites.folders.archive.useMutation({
    onSuccess: (_result, variables) => {
      invalidate();
      if (variables.folderId === selectedSuiteId) selectSuite({ kind: "all" });
    },
    onError: toastOnError("Couldn't archive the test suite"),
  });

  return {
    isArchiving: archive.isPending,
    createSuite: (name) => create.mutate({ projectId, name }),
    archiveSuite: (suiteId) => archive.mutate({ projectId, folderId: suiteId }),
  };
}

export type CaseMutations = {
  /** The case the archive dialog is open on, if any. */
  caseToArchive: TestCase | null;
  setCaseToArchive: (testCase: TestCase | null) => void;
  isArchiving: boolean;
  archiveCase: () => void;
  duplicateCase: (testCase: TestCase) => void;
  moveCaseToSuite: (testCase: TestCase, suiteId: string | null) => void;
};

export function useCaseMutations(projectId: string): CaseMutations {
  const invalidate = useCasesInvalidate(projectId);
  const [caseToArchive, setCaseToArchive] = useState<TestCase | null>(null);

  const archive = api.scenarios.archive.useMutation({
    onSuccess: () => {
      invalidate();
      setCaseToArchive(null);
    },
    onError: toastOnError("Couldn't archive the test case"),
  });

  const duplicate = api.scenarios.duplicate.useMutation({
    onSuccess: () => {
      invalidate();
      toaster.create({ title: "Test case duplicated", type: "success" });
    },
    onError: toastOnError("Couldn't duplicate the test case"),
  });

  const move = api.scenarios.moveToFolder.useMutation({
    onSuccess: invalidate,
    onError: toastOnError("Couldn't move the test case"),
  });

  return {
    caseToArchive,
    setCaseToArchive,
    isArchiving: archive.isPending,
    archiveCase: () => {
      if (!caseToArchive) return;
      archive.mutate({ projectId, id: caseToArchive.id });
    },
    duplicateCase: (testCase) =>
      duplicate.mutate({ projectId, scenarioId: testCase.id }),
    moveCaseToSuite: (testCase, suiteId) =>
      move.mutate({ projectId, scenarioId: testCase.id, folderId: suiteId }),
  };
}
