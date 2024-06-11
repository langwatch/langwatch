import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { type AppType } from "next/app";

import { api } from "~/utils/api";

import { switchAnatomy } from "@chakra-ui/anatomy";
import {
  ChakraProvider,
  defineStyle,
  defineStyleConfig,
  createMultiStyleConfigHelpers,
  type StyleFunctionProps,
} from "@chakra-ui/react";
import "~/styles/globals.scss";
import "~/styles/markdown.scss";

import { extendTheme } from "@chakra-ui/react";
import debounce from "lodash.debounce";
import { Inter } from "next/font/google";
import Head from "next/head";
import { useRouter } from "next/router";
import NProgress from "nprogress";
import { useEffect, useState } from "react";
import { dependencies } from "../injection/dependencies.client";

const inter = Inter({ subsets: ["latin"] });

// eslint-disable-next-line @typescript-eslint/unbound-method
const { definePartsStyle, defineMultiStyleConfig } =
  createMultiStyleConfigHelpers(switchAnatomy.keys);

export const theme = extendTheme({
  styles: {
    global: (_props: StyleFunctionProps) => ({
      body: {
        background: "#E5E7EB",
      },
    }),
  },
  fonts: {
    heading: inter.style.fontFamily,
    body: inter.style.fontFamily,
  },
  colors: {
    gray: {
      800: "#090F1D",
      700: "#1F2937",
      600: "#213B41",
      500: "#51676C",
      400: "#9CA3AF",
      375: "#B8BDBD",
      350: "#DDDDDD",
      300: "#E5E7EB",
      200: "#E6E9F0",
      100: "#F2F4F8",
      50: "#F7FAFC",
    },
    orange: {
      700: "#c05621",
      600: "#dd6b20",
      500: "#ED8926",
      400: "#ED8926",
      300: "#FF9E2C",
      200: "#FFD19B",
      100: "#FFF3E4",
    },
  },
  components: {
    Table: {
      variants: {
        grid: {
          th: {
            border: "1px solid",
            borderColor: "gray.200",
            background: "gray.50",
          },
          td: {
            border: "1px solid",
            borderColor: "gray.200",
          },
        },
      },
    },
    Card: defineStyleConfig({
      baseStyle: {
        container: {
          boxShadow: "0px 4px 10px 0px rgba(0, 0, 0, 0.06)",
        },
      },
    }),
    Tag: defineStyleConfig({
      baseStyle: {
        container: {
          borderRadius: "62px",
          paddingX: 4,
        },
      },
    }),
    Button: defineStyleConfig({
      variants: {
        outline: defineStyle({
          borderColor: "gray.300",
        }),
      },
    }),
    Drawer: defineStyleConfig({
      sizes: {
        span: {
          dialog: { maxWidth: "70%" },
        },
        full: {
          dialog: { maxWidth: "100%" },
        },
        eval: {
          dialog: { maxWidth: "1024px" },
        },
      },
    }),
    Switch: defineMultiStyleConfig({
      variants: {
        darkerTrack: definePartsStyle({
          track: {
            background: "gray.400",
            _checked: {
              background: "blue.500",
            },
          },
        }),
      },
    }),
  },
});

const handleChangeStart = debounce(() => NProgress.start(), 200);

const LangWatch: AppType<{
  session: Session | null;
  injected?: string | undefined;
}> = ({ Component, pageProps: { session, ...pageProps } }) => {
  const router = useRouter();

  const [previousFeatureFlagQueryParams, setPreviousFeatureFlagQueryParams] =
    useState<{ key: string; value: string }[]>([]);

  useEffect(() => {
    const featureFlagQueryParams = Object.entries(router.query ?? {})
      .filter(
        ([key]) =>
          key.startsWith("NEXT_PUBLIC_FEATURE_") &&
          typeof router.query[key] === "string"
      )
      .map(([key, value]) => ({ key, value: value as string }));
    setPreviousFeatureFlagQueryParams(featureFlagQueryParams);
  }, [router.query]);

  // Little hack to keep the feature flags on the url the same when navigating to a different page
  const keepSameFeatureFlags = () => {
    if (Object.keys(previousFeatureFlagQueryParams).length > 0) {
      const parsedUrl = new URL(window.location.href);
      let updated = false;
      for (const { key, value } of previousFeatureFlagQueryParams) {
        if (parsedUrl.searchParams.get(key) !== value) {
          parsedUrl.searchParams.set(key, value);
          updated = true;
        }
      }
      if (updated) {
        void router.replace(parsedUrl.toString(), undefined, {
          shallow: true,
        });
      }
    }
  };

  useEffect(() => {
    NProgress.configure({ showSpinner: false });
    const handleChangeDone = () => {
      keepSameFeatureFlags();
      handleChangeStart.cancel();
      NProgress.done();
      setTimeout(() => NProgress.done(), 200);
    };
    const handleChangeStart_ = () => {
      handleChangeStart();
    };

    router.events.on("routeChangeStart", handleChangeStart_);
    router.events.on("routeChangeComplete", handleChangeDone);
    router.events.on("routeChangeError", handleChangeDone);

    return () => {
      router.events.off("routeChangeStart", handleChangeStart_);
      router.events.off("routeChangeComplete", handleChangeDone);
      router.events.off("routeChangeError", handleChangeDone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return (
    <SessionProvider
      session={session}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      <ChakraProvider
        theme={theme}
        toastOptions={{ defaultOptions: { position: "top-right" } }}
      >
        <Head>
          <title>LangWatch</title>
        </Head>
        <Component {...pageProps} />

        {session && dependencies.ExtraFooterComponents && (
          <dependencies.ExtraFooterComponents />
        )}
      </ChakraProvider>
    </SessionProvider>
  );
};

export default api.withTRPC(LangWatch);
