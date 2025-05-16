export type CopilotStoreState = {
    code: string | null;
};

export type CopilotStore = CopilotStoreState & {
    setCode: (code: string) => void;
};

export const initialCopilotStore: CopilotStoreState = {
    code: null,
};

export const createCopilotStore = (set: (state: CopilotStoreState) => void, get: () => CopilotStoreState): CopilotStore => {
    return {
        ...initialCopilotStore,
        setCode: (code: string) => set({ code }),
    };
};
