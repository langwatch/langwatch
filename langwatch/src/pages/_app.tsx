import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { type AppType } from "next/app";

import { api } from "~/utils/api";

import {
  ChakraProvider,
  defaultConfig,
  createSystem,
  defineRecipe,
  defineSlotRecipe,
} from "@chakra-ui/react";
import "~/styles/globals.scss";
import "~/styles/markdown.scss";

import { Inter } from "next/font/google";
import Head from "next/head";
import { useRouter } from "next/router";
import NProgress from "nprogress";
import { useEffect, useState } from "react";
import { dependencies } from "../injection/dependencies.client";
import { Toaster } from "../components/ui/toaster";

const inter = Inter({ subsets: ["latin"] });

export const system = createSystem(defaultConfig, {
  globalCss: {
    body: {
      background: "#E5E7EB",
      fontSize: "14px",
    },
    "*::selection": {
      // Chakra by default overrides browser selection color, I really don't like things overriding defaults
      // @ts-ignore
      bg: null,
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
          375: { value: "#B8BDBD" },
          350: { value: "#DDDDDD" },
          300: { value: "#E5E7EB" },
          200: { value: "#E6E9F0" },
          100: { value: "#F2F4F8" },
          50: { value: "#F7FAFC" },
        },
        red: {
          50: { value: "#FFF5F5" },
          100: { value: "#FED7D7" },
          200: { value: "#FEB2B2" },
          300: { value: "#FC8181" },
          400: { value: "#F56565" },
          500: { value: "#E53E3E" },
          600: { value: "#C53030" },
          700: { value: "#9B2C2C" },
          800: { value: "#822727" },
          900: { value: "#63171B" },
        },
        orange: {
          700: { value: "#c05621" },
          600: { value: "#dd6b20" },
          500: { value: "#ED8926" },
          400: { value: "#ED8926" },
          300: { value: "#FF9E2C" },
          200: { value: "#FFD19B" },
          100: { value: "#FFF3E4" },
        },
        yellow: {
          50: { value: "#FFFFF0" },
          100: { value: "#FEFCBF" },
          200: { value: "#FAF089" },
          300: { value: "#F6E05E" },
          400: { value: "#ECC94B" },
          500: { value: "#D69E2E" },
          600: { value: "#B7791F" },
          700: { value: "#975A16" },
          800: { value: "#744210" },
          900: { value: "#5F370E" },
        },
        green: {
          50: { value: "#F0FFF4" },
          100: { value: "#C6F6D5" },
          200: { value: "#9AE6B4" },
          300: { value: "#68D391" },
          400: { value: "#48BB78" },
          500: { value: "#38A169" },
          600: { value: "#2F855A" },
          700: { value: "#276749" },
          800: { value: "#22543D" },
          900: { value: "#1C4532" },
        },
        teal: {
          50: { value: "#E6FFFA" },
          100: { value: "#B2F5EA" },
          200: { value: "#81E6D9" },
          300: { value: "#4FD1C5" },
          400: { value: "#38B2AC" },
          500: { value: "#319795" },
          600: { value: "#2C7A7B" },
          700: { value: "#285E61" },
          800: { value: "#234E52" },
          900: { value: "#1D4044" },
        },
        blue: {
          50: { value: "#ebf8ff" },
          100: { value: "#bee3f8" },
          200: { value: "#90cdf4" },
          300: { value: "#63b3ed" },
          400: { value: "#4299e1" },
          500: { value: "#3182ce" },
          600: { value: "#2b6cb0" },
          700: { value: "#2c5282" },
          800: { value: "#2a4365" },
          900: { value: "#1A365D" },
        },
        cyan: {
          50: { value: "#EDFDFD" },
          100: { value: "#C4F1F9" },
          200: { value: "#9DECF9" },
          300: { value: "#76E4F7" },
          400: { value: "#0BC5EA" },
          500: { value: "#00B5D8" },
          600: { value: "#00A3C4" },
          700: { value: "#0987A0" },
          800: { value: "#086F83" },
          900: { value: "#065666" },
        },
        purple: {
          50: { value: "#FAF5FF" },
          100: { value: "#E9D8FD" },
          200: { value: "#D6BCFA" },
          300: { value: "#B794F4" },
          400: { value: "#9F7AEA" },
          500: { value: "#805AD5" },
          600: { value: "#6B46C1" },
          700: { value: "#553C9A" },
          800: { value: "#44337A" },
          900: { value: "#322659" },
        },
        pink: {
          50: { value: "#FFF5F7" },
          100: { value: "#FED7E2" },
          200: { value: "#FBB6CE" },
          300: { value: "#F687B3" },
          400: { value: "#ED64A6" },
          500: { value: "#D53F8C" },
          600: { value: "#B83280" },
          700: { value: "#97266D" },
          800: { value: "#702459" },
          900: { value: "#521B41" },
        },
      },
      // TODO: those are not working, we need to manually override cursors below
      cursor: {
        button: {
          value: "pointer",
        },
        menuitem: {
          value: "pointer",
        },
        checkbox: {
          value: "pointer",
        },
        radio: {
          value: "pointer",
        },
        slider: {
          value: "pointer",
        },
        switch: {
          value: "pointer",
        },
      },
    },
    semanticTokens: {
      colors: {
        gray: {
          solid: { value: "{colors.gray.100}" },
          contrast: { value: "{colors.gray.800}" },
          subtle: { value: "{colors.gray.200}" },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        orange: {
          solid: { value: "#ED8926" },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        green: {
          solid: { value: "{colors.green.500}" },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        blue: {
          solid: { value: "{colors.blue.500}" },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
      },
    },
    recipes: {
      heading: defineRecipe({
        variants: {
          size: {
            lg: { textStyle: "2xl" },
          },
        },
      }),
      link: defineRecipe({
        base: {
          focusRing: "none",
        },
      }),
      tag: defineRecipe({
        base: {
          borderRadius: "62px",
          paddingX: 4,
        },
      }),
      button: defineRecipe({
        base: {
          fontWeight: 600,
        },
        variants: {
          variant: {
            outline: {
              borderColor: "gray.300",
            },
          },
          size: {
            xs: {
              h: "6",
              minW: "6",
              textStyle: "xs",
              px: "1.5",
              gap: "1",
              _icon: {
                flexShrink: 0,
                width: "auto",
                height: "auto",
              },
            },
            sm: {
              h: "8",
              minW: "8",
              px: "2.5",
              _icon: {
                flexShrink: 1,
                width: "auto",
                height: "auto",
                maxWidth: "16px",
                maxHeight: "16px",
              },
            },
            md: {
              _icon: {
                flexShrink: 1,
                width: "auto",
                height: "auto",
                maxWidth: "20px",
                maxHeight: "20px",
              },
            },
          },
        },
        defaultVariants: {
          size: "sm",
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
      separator: defineRecipe({
        base: {
          width: "full",
        },
      }),
      input: defineRecipe({
        base: {
          borderRadius: "l1",
        },
        variants: {
          size: {
            xs: {
              "--input-height": "sizes.7",
            },
            sm: {
              "--input-height": "sizes.8",
            },
          },
        },
      }),
    },
    slotRecipes: {
      card: defineSlotRecipe({
        slots: ["root"],
        variants: {
          variant: {
            elevated: {
              root: {
                border: "1px solid",
                borderColor: "gray.300",
                boxShadow: "0px 4px 10px 0px rgba(0, 0, 0, 0.06)",
              },
            },
          },
          size: {
            md: {
              root: {
                "--card-padding": "spacing.5",
              },
            },
          },
        },
        defaultVariants: {
          size: "md",
        },
      }),
      checkbox: defineSlotRecipe({
        slots: ["root", "control", "label"],
        base: {
          control: {
            borderWidth: "1px",
            cursor: "pointer",
          },
          label: {
            fontWeight: "normal",
          },
        },
        variants: {
          variant: {
            solid: {
              control: {
                borderColor: "gray.350",
                "&:is([data-state=checked], [data-state=indeterminate])": {
                  bg: "blue.500",
                  color: "white",
                  borderColor: "blue.500",
                },
              },
            },
          },
        },
        defaultVariants: {
          // @ts-ignore
          size: "sm",
        },
      }),
      tabs: defineSlotRecipe({
        slots: ["root", "list", "trigger"],
        base: {
          trigger: {
            height: "auto",
          },
        },
      }),
      menu: defineSlotRecipe({
        slots: ["item"],
        base: {
          item: {
            cursor: "pointer",
          },
        },
        variants: {
          size: {
            md: {
              item: {
                _icon: {
                  flexShrink: 1,
                  width: "auto",
                  height: "auto",
                  maxWidth: "16px",
                  maxHeight: "16px",
                },
              },
            },
          },
        },
      }),
      table: defineSlotRecipe({
        slots: ["root"],
        base: {
          columnHeader: {
            fontWeight: "bold",
            textStyle: "xs",
            textTransform: "uppercase",
            color: "gray.600",
            letterSpacing: "wider",
          },
        },
        variants: {
          variant: {
            // add grid variant following previous pattern
            grid: {
              columnHeader: {
                border: "1px solid",
                borderColor: "gray.200",
                background: "gray.50",
              },
              cell: {
                border: "1px solid",
                borderColor: "gray.200",
              },
            },
            line: {
              columnHeader: {
                borderColor: "gray.100",
              },
              cell: {
                borderColor: "gray.100",
              },
            },
          },
          size: {
            xs: {
              row: {
                lineHeight: "1em",
              },
              columnHeader: {
                fontSize: "11px",
                paddingY: 2,
                paddingX: 3,
              },
              cell: {
                fontSize: "13px",
                paddingY: 2,
                paddingX: 3,
              },
            },
            sm: {
              columnHeader: {
                px: "2",
                py: "2",
              },
              cell: {
                px: "2",
                py: "6px",
              },
            },
          },
        },
      }),
      switch: defineSlotRecipe({
        slots: ["root", "control", "thumb"],
        variants: {
          variant: {
            darkerTrack: {
              control: {
                background: "gray.400",
                _checked: {
                  background: "blue.500",
                },
              },
              thumb: {
                background: "white",
                width: "var(--switch-height)",
                height: "var(--switch-height)",
                scale: "0.8",
                boxShadow: "sm",
                _checked: {
                  background: "white",
                },
              },
            },
          },
        },
      }),
      accordion: defineSlotRecipe({
        slots: ["itemTrigger"],
        base: {
          itemTrigger: {
            cursor: "pointer",
            _hover: {
              bg: "gray.50",
            },
          },
        },
      }),
      dialog: defineSlotRecipe({
        slots: ["content"],
        variants: {
          size: {
            "5xl": {
              content: { maxWidth: "5xl" },
            },
            "6xl": {
              content: { maxWidth: "6xl" },
            },
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
        <Toaster />

        {dependencies.ExtraFooterComponents && (
          <dependencies.ExtraFooterComponents />
        )}
      </ChakraProvider>
    </SessionProvider>
  );
};

export default api.withTRPC(LangWatch);
