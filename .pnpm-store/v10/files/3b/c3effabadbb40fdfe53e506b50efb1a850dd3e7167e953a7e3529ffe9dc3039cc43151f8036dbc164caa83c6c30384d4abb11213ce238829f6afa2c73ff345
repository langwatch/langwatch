import { type Session, type SessionInputCallback } from '../memory/session';
import { RunResult, StreamedRunResult } from '../result';
import { AgentInputItem } from '../types';
export type PreparedInputWithSessionResult = {
    preparedInput: string | AgentInputItem[];
    sessionItems?: AgentInputItem[];
};
export type SessionPersistenceTracker = {
    setPreparedItems: (items?: AgentInputItem[]) => void;
    recordTurnItems: (sourceItems: (AgentInputItem | undefined)[], filteredItems?: AgentInputItem[]) => void;
    getItemsForPersistence: () => AgentInputItem[] | undefined;
    buildPersistInputOnce: (serverManagesConversation: boolean) => (() => Promise<void>) | undefined;
};
export declare function createSessionPersistenceTracker(options: {
    session?: Session;
    hasCallModelInputFilter: boolean;
    persistInput?: typeof saveStreamInputToSession;
    resumingFromState?: boolean;
}): SessionPersistenceTracker | undefined;
export declare function saveToSession(session: Session | undefined, sessionInputItems: AgentInputItem[] | undefined, result: RunResult<any, any>): Promise<void>;
export declare function saveStreamInputToSession(session: Session | undefined, sessionInputItems: AgentInputItem[] | undefined): Promise<void>;
export declare function saveStreamResultToSession(session: Session | undefined, result: StreamedRunResult<any, any>): Promise<void>;
export declare function prepareInputItemsWithSession(input: string | AgentInputItem[], session?: Session, sessionInputCallback?: SessionInputCallback, options?: {
    includeHistoryInPreparedInput?: boolean;
    preserveDroppedNewItems?: boolean;
}): Promise<PreparedInputWithSessionResult>;
