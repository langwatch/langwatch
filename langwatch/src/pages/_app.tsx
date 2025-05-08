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
import { colorSystem } from "../components/ui/color-mode";

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
      colors: colorSystem,
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
        option: {
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
          subtle: { value: "{colors.orange.50}" },
          fg: { value: "{colors.orange.800}" },
        },
        green: {
          solid: { value: "{colors.green.500}" },
          subtle: { value: "{colors.green.50}" },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        blue: {
          solid: { value: "{colors.blue.500}" },
          subtle: { value: "{colors.blue.50}" },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        yellow: {
          solid: { value: "{colors.yellow.500}" },
          subtle: { value: "{colors.yellow.50}" },
          focusRing: { value: "rgb(49, 130, 206)" },
        },
        red: {
          solid: { value: "{colors.red.500}" },
          subtle: { value: "{colors.red.50}" },
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
              color: "gray.800",
              _hover: {
                backgroundColor: "gray.50",
              },
              _expanded: {
                backgroundColor: "gray.50",
              },
            },
            ghost: {
              color: "gray.800",
              _hover: {
                backgroundColor: "gray.50",
              },
              _expanded: {
                backgroundColor: "gray.50",
              },
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
      separator: defineRecipe({
        variants: {
          orientation: {
            vertical: {
              width: "1px",
              height: "full",
            },
            horizontal: {
              height: "1px",
              width: "full",
            },
          },
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
            cursor: "pointer",
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
        variants: {
          variant: {
            line: {
              trigger: {
                _selected: {
                  color: "colorPalette.solid",
                },
              },
            },
          },
          size: {
            sm: {
              root: {
                "--tabs-height": "sizes.8",
                "--tabs-content-padding": "spacing.3",
              },
              trigger: {
                py: "1",
                px: "3",
                textStyle: "sm",
              },
            },
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
      select: defineSlotRecipe({
        slots: ["trigger"],
        base: {
          trigger: {
            cursor: "pointer",
          },
        },
      }),
      drawer: defineSlotRecipe({
        slots: ["content"],
        base: {
          content: { maxWidth: "70%" },
        },
        variants: {
          size: {
            span: { content: { maxWidth: "70%" } },
            full: { content: { maxWidth: "100%" } },
            eval: { content: { maxWidth: "1024px" } },
            xl: { content: { maxWidth: "4xl" } },
          },
        },
        defaultVariants: {
          size: "xl",
        },
      }),
      toast: defineSlotRecipe({
        slots: ["root"],
        base: {
          root: {
            "&[data-type=info]": {
              bg: "blue.solid",
              color: "blue.contrast",
              "--toast-trigger-bg": "{white/10}",
              "--toast-border-color": "{white/40}",
            },
          },
        },
      }),
      progress: defineSlotRecipe({
        slots: ["root", "track", "range"],
        variants: {
          // @ts-ignore
          striped: {
            true: {
              range: {
                "--stripe-color": "rgba(255, 255, 255, 0.2)",
              },
            },
          },
        },
      }),

      alert: defineSlotRecipe({
        slots: ["root"],
        defaultVariants: {
          variant: "surface",
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
