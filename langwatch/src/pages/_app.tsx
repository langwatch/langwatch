import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { type AppType } from "next/app";

import { api } from "~/utils/api";

import {
  ChakraProvider,
  defaultConfig,
  createSystem,
  defineRecipe,
} from "@chakra-ui/react";
import "~/styles/globals.scss";
import "~/styles/markdown.scss";

import { Inter } from "next/font/google";
import Head from "next/head";
import { useRouter } from "next/router";
import NProgress from "nprogress";
import { useEffect, useState } from "react";
import { dependencies } from "../injection/dependencies.client";

const inter = Inter({ subsets: ["latin"] });

export const system = createSystem(defaultConfig, {
  globalCss: {
    body: {
      background: "#E5E7EB",
    },
  },
  theme: {
    tokens: {
      fonts: {
        heading: {
          value: inter.style.fontFamily,
        },
        body: {
          value: inter.style.fontFamily,
        },
      },
      colors: {
        gray: {
          800: { value: "#090F1D" },
          700: { value: "#1F2937" },
          600: { value: "#213B41" },
          500: { value: "#51676C" },
          400: { value: "#9CA3AF" },
          300: { value: "#E5E7EB" },
          200: { value: "#E6E9F0" },
          100: { value: "#F2F4F8" },
          50: { value: "#F7FAFC" },
        },
        orange: {
          700: { value: "#c05621" },
          600: { value: "#dd6b20" },
          500: { value: "#ED8926" },
          300: { value: "#FF9E2C" },
          200: { value: "#FFD19B" },
          100: { value: "#FFF3E4" },
        },
      },
    },
    recipes: {
      table: defineRecipe({
        variants: {
          variant: {
            grid: {
              header: {
                border: "1px solid",
                borderColor: "gray.200",
                background: "gray.50",
              },
              row: {
                border: "1px solid",
                borderColor: "gray.200",
              },
            },
          },
          sizes: {
            xs: {
              tr: {
                lineHeight: "1em",
              },
              th: {
                fontSize: "11px",
                paddingY: 2,
                paddingX: 3,
              },
              td: {
                fontSize: "13px",
                paddingY: 2,
                paddingX: 3,
              },
            },
          },
        },
      }),
      card: defineRecipe({
        base: {
          boxShadow: "0px 4px 10px 0px rgba(0, 0, 0, 0.06)",
        },
      }),
      tag: defineRecipe({
        base: {
          borderRadius: "62px",
          paddingX: 4,
        },
      }),
      button: defineRecipe({
        variants: {
          variant: {
            outline: {
              borderColor: "gray.300",
            },
          },
        },
      }),
      drawer: defineRecipe({
        variants: {
          size: {
            span: { maxWidth: "70%" },
            full: { maxWidth: "100%" },
            eval: { maxWidth: "1024px" },
          },
        },
      }),
      switch: defineRecipe({
        variants: {
          variant: {
            darkerTrack: { control: { background: "gray.400" } },
          },
        },
      }),
    },
  },
});

let handleChangeStartTimeout: NodeJS.Timeout | null = null;
let nProgressEnabled = false;
setTimeout(() => {
  nProgressEnabled = true;
}, 1000);

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
      if (handleChangeStartTimeout) {
        clearTimeout(handleChangeStartTimeout);
        handleChangeStartTimeout = null;
      }
      NProgress.done();
    };
    const handleChangeStart_ = () => {
      if (nProgressEnabled && !handleChangeStartTimeout) {
        handleChangeStartTimeout = setTimeout(() => {
          NProgress.start();
          handleChangeStartTimeout = null;
        }, 100);
      }
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
      <ChakraProvider value={system}>
        <Head>
          <title>LangWatch</title>
        </Head>
        <Component {...pageProps} />

        {dependencies.ExtraFooterComponents && (
          <dependencies.ExtraFooterComponents />
        )}
      </ChakraProvider>
    </SessionProvider>
  );
};

export default api.withTRPC(LangWatch);
