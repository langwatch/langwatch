import { getRuntimeConfig as getBrowserRuntimeConfig } from "./runtimeConfig.browser";
export const getRuntimeConfig = (config) => {
    const browserDefaults = getBrowserRuntimeConfig(config);
    return {
        ...browserDefaults,
        ...config,
        runtime: "react-native",
    };
};
