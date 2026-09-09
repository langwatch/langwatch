/**
 * The provider marks the providers table and the default-models chips render.
 *
 * A family-local copy of the map in `platform/app/src/components/modelProviders/iconsMap.tsx`,
 * cut down to the map itself — the same copy `@langwatch/gateway-web` took for
 * its two provider lists, character for character, so the two never disagree
 * about what a vendor looks like. What the platform module also carries — the
 * monochrome set and the `ProviderIconGlyph` wrapper that keeps a flat black
 * mark legible on the dark theme — stays there; neither screen here calls
 * either, so neither travels.
 *
 * A THIRD COPY IS THE SIGNAL, and it is recorded rather than acted on: these
 * are the MODEL PROVIDER feature's marks, so this package is where they belong
 * and `@langwatch/gateway-web` should eventually import them from a surface
 * here. Promoting them is a change to two packages plus eleven `platform/app`
 * call sites, which a page-family move does not own. See
 * `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * The four marks the Design System already publishes are imported rather than
 * copied. The remaining ten are drawn here because they are `platform/app`
 * components the whole product still uses.
 *
 * The key set is the contract's, so a provider added to the registry fails the
 * typecheck here rather than rendering a blank cell.
 */

import { Box } from "@chakra-ui/react";
import { AnthropicIcon, AWSIcon, CustomIcon, OpenAIIcon } from "@langwatch/design-system/icons";
import type { modelProviders } from "@langwatch/model-provider-contract";
import { useId, type ReactNode } from "react";

function AzureIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <defs>
        <linearGradient
          id="e399c19f-b68f-429d-b176-18c2117ff73c"
          x1="-1032.172"
          x2="-1059.213"
          y1="145.312"
          y2="65.426"
          gradientTransform="matrix(1 0 0 -1 1075 158)"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#114a8b"></stop>
          <stop offset="1" stopColor="#0669bc"></stop>
        </linearGradient>
        <linearGradient
          id="ac2a6fc2-ca48-4327-9a3c-d4dcc3256e15"
          x1="-1023.725"
          x2="-1029.98"
          y1="108.083"
          y2="105.968"
          gradientTransform="matrix(1 0 0 -1 1075 158)"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopOpacity="0.3"></stop>
          <stop offset="0.071" stopOpacity="0.2"></stop>
          <stop offset="0.321" stopOpacity="0.1"></stop>
          <stop offset="0.623" stopOpacity="0.05"></stop>
          <stop offset="1" stopOpacity="0"></stop>
        </linearGradient>
        <linearGradient
          id="a7fee970-a784-4bb1-af8d-63d18e5f7db9"
          x1="-1027.165"
          x2="-997.482"
          y1="147.642"
          y2="68.561"
          gradientTransform="matrix(1 0 0 -1 1075 158)"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#3ccbf4"></stop>
          <stop offset="1" stopColor="#2892df"></stop>
        </linearGradient>
      </defs>
      <path
        fill="url(#e399c19f-b68f-429d-b176-18c2117ff73c)"
        d="M33.338 6.544h26.038l-27.03 80.087a4.152 4.152 0 01-3.933 2.824H8.149a4.145 4.145 0 01-3.928-5.47L29.404 9.368a4.152 4.152 0 013.934-2.825z"
      ></path>
      <path
        fill="#0078d4"
        d="M71.175 60.261h-41.29a1.911 1.911 0 00-1.305 3.309l26.532 24.764a4.171 4.171 0 002.846 1.121h23.38z"
      ></path>
      <path
        fill="url(#ac2a6fc2-ca48-4327-9a3c-d4dcc3256e15)"
        d="M33.338 6.544a4.118 4.118 0 00-3.943 2.879L4.252 83.917a4.14 4.14 0 003.908 5.538h20.787a4.443 4.443 0 003.41-2.9l5.014-14.777 17.91 16.705a4.237 4.237 0 002.666.972H81.24L71.024 60.261l-29.781.007L59.47 6.544z"
      ></path>
      <path
        fill="url(#a7fee970-a784-4bb1-af8d-63d18e5f7db9)"
        d="M66.595 9.364a4.145 4.145 0 00-3.928-2.82H33.648a4.146 4.146 0 013.928 2.82l25.184 74.62a4.146 4.146 0 01-3.928 5.472h29.02a4.146 4.146 0 003.927-5.472z"
      ></path>
    </svg>
  );
}

function CerebrasIcon() {
  return (
    <svg
      fill="currentColor"
      style={{ flex: "none", lineHeight: "1" }}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Cerebras</title>
      <path
        clipRule="evenodd"
        d="M14.121 2.701a9.299 9.299 0 000 18.598V22.7c-5.91 0-10.7-4.791-10.7-10.701S8.21 1.299 14.12 1.299V2.7zm4.752 3.677A7.353 7.353 0 109.42 17.643l-.901 1.074a8.754 8.754 0 01-1.08-12.334 8.755 8.755 0 0112.335-1.08l-.901 1.075zm-2.255.844a5.407 5.407 0 00-5.048 9.563l-.656 1.24a6.81 6.81 0 016.358-12.043l-.654 1.24zM14.12 8.539a3.46 3.46 0 100 6.922v1.402a4.863 4.863 0 010-9.726v1.402z"
        fill="#F15A29"
        fillRule="evenodd"
      ></path>
      <path d="M15.407 10.836a2.24 2.24 0 00-.51-.409 1.084 1.084 0 00-.544-.152c-.255 0-.483.047-.684.14a1.58 1.58 0 00-.84.912c-.074.203-.11.416-.11.631 0 .218.036.43.11.631a1.594 1.594 0 00.84.913c.2.093.43.14.684.14.216 0 .417-.046.602-.135.188-.09.35-.225.475-.392l.928 1.006c-.14.14-.3.261-.482.363a3.367 3.367 0 01-1.083.38c-.17.026-.317.04-.44.04a3.315 3.315 0 01-1.182-.21 2.825 2.825 0 01-.961-.597 2.816 2.816 0 01-.644-.929 2.987 2.987 0 01-.238-1.21c0-.444.08-.847.238-1.21.15-.35.368-.666.643-.929.278-.261.605-.464.962-.596a3.315 3.315 0 011.182-.21c.355 0 .712.068 1.072.204.361.138.685.36.944.649l-.962.97z"></path>
    </svg>
  );
}

/**
 * Two treatments toggled by color mode with pure CSS on `<g>` groups (no hook,
 * so it is SSR- and test-safe): the full-color brand tile in light mode, and
 * the monochrome glyph in white for dark mode, where the light tile's white
 * rounded square would otherwise glare.
 */
function CodexIcon() {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <title>Codex</title>
      <Box as="g" _dark={{ display: "none" }}>
        <path
          d="M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z"
          fill="#fff"
        />
        <path
          d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z"
          fill="url(#codex-brand-gradient)"
        />
      </Box>
      <Box as="g" display="none" _dark={{ display: "inline" }}>
        <path
          fill="#fff"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"
        />
      </Box>
      <defs>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id="codex-brand-gradient"
          x1="12"
          x2="12"
          y1="3"
          y2="21"
        >
          <stop stopColor="#B1A7FF" />
          <stop offset=".5" stopColor="#7A9DFF" />
          <stop offset="1" stopColor="#3941FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function DeepSeekIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 512 512">
      <g clipPath="url(#clip0_5770_2470)">
        <path
          fill="#4D6BFE"
          d="M506.624 95.616c-5.419-2.645-7.765 2.41-10.923 4.992-1.088.832-2.005 1.92-2.922 2.902-7.936 8.469-17.195 14.016-29.291 13.354-17.685-.981-32.789 4.566-46.144 18.091-2.837-16.683-12.267-26.624-26.603-33.024-7.509-3.328-15.104-6.635-20.373-13.867-3.669-5.141-4.672-10.88-6.507-16.512-1.173-3.413-2.346-6.89-6.25-7.467-4.267-.66-5.931 2.902-7.595 5.889-6.677 12.202-9.259 25.642-9.003 39.253.576 30.634 13.504 55.04 39.211 72.384 2.923 1.984 3.669 3.989 2.752 6.89-1.749 5.974-3.84 11.776-5.675 17.771-1.173 3.819-2.922 4.629-7.018 2.987a117.9 117.9 0 0 1-37.035-25.174c-18.283-17.664-34.795-37.162-55.403-52.437a243 243 0 0 0-14.698-10.048c-21.014-20.416 2.773-37.184 8.277-39.168 5.76-2.09 1.984-9.216-16.619-9.13-18.602.085-35.626 6.293-57.322 14.591a65 65 0 0 1-9.92 2.923 204.7 204.7 0 0 0-61.504-2.176c-40.214 4.48-72.32 23.509-95.936 55.957-28.374 38.998-35.051 83.328-26.88 129.536 8.597 48.726 33.472 89.067 71.68 120.598 39.637 32.704 85.269 48.725 137.344 45.653 31.616-1.813 66.837-6.059 106.538-39.68 10.027 4.992 20.523 6.976 37.974 8.469 13.44 1.259 26.368-.64 36.373-2.73 15.68-3.328 14.592-17.856 8.939-20.502-45.974-21.418-35.883-12.693-45.078-19.754 23.382-27.648 58.582-56.363 72.363-149.398 1.067-7.402.149-12.053 0-18.026-.085-3.627.747-5.056 4.907-5.462a89 89 0 0 0 32.96-10.133c29.781-16.277 41.813-42.987 44.65-75.029.427-4.907-.085-9.941-5.269-12.523M247.061 384c-44.565-35.029-66.176-46.571-75.093-46.08-8.363.512-6.848 10.048-5.013 16.277 1.92 6.144 4.416 10.368 7.914 15.766 2.432 3.562 4.096 8.874-2.41 12.864-14.358 8.874-39.296-2.987-40.47-3.563-29.034-17.109-53.333-39.68-70.421-70.549-16.512-29.718-26.112-61.59-27.69-95.616-.427-8.235 1.983-11.136 10.175-12.63a100.2 100.2 0 0 1 32.619-.832c45.483 6.656 84.181 26.987 116.651 59.179 18.517 18.347 32.533 40.256 46.976 61.675 15.36 22.741 31.872 44.416 52.906 62.165 7.424 6.229 13.334 10.965 19.008 14.443-17.109 1.92-45.653 2.346-65.152-13.099m21.334-137.387a6.527 6.527 0 0 1 8.853-6.122 6.45 6.45 0 0 1 4.267 6.144 6.55 6.55 0 0 1-1.935 4.66 6.51 6.51 0 0 1-4.679 1.889 6.45 6.45 0 0 1-4.622-1.923 6.5 6.5 0 0 1-1.4-2.136 6.5 6.5 0 0 1-.484-2.512m66.346 34.048c-4.266 1.728-8.512 3.222-12.586 3.414a26.56 26.56 0 0 1-17.024-5.419c-5.846-4.907-10.027-7.637-11.776-16.171a36.9 36.9 0 0 1 .341-12.544c1.493-6.976-.171-11.456-5.099-15.509-3.989-3.328-9.088-4.245-14.677-4.245a11.9 11.9 0 0 1-5.419-1.664c-2.346-1.152-4.266-4.054-2.432-7.638.598-1.152 3.414-3.968 4.096-4.48 7.595-4.309 16.363-2.901 24.448.342 7.51 3.072 13.184 8.704 21.355 16.682 8.341 9.622 9.856 12.288 14.613 19.499 3.755 5.653 7.168 11.456 9.494 18.091 1.429 4.16-.406 7.552-5.334 9.642"
        ></path>
      </g>
      <defs>
        <clipPath id="clip0_5770_2470">
          <path fill="#fff" d="M0 0h512v512H0z"></path>
        </clipPath>
      </defs>
    </svg>
  );
}

function ElevenLabsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      {/* ElevenLabs wordmark reduces to the "II" glyph: two vertical bars. */}
      <path fill="currentColor" d="M8 3.5h3v17H8v-17zm5 0h3v17h-3v-17z"></path>
    </svg>
  );
}

function GeminiIcon() {
  const gradientId = useId();
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 16 16">
      <path
        fill={`url(#${gradientId})`}
        d="M16 8.016A8.52 8.52 0 0 0 8.016 16h-.032A8.52 8.52 0 0 0 0 8.016v-.032A8.52 8.52 0 0 0 7.984 0h.032A8.52 8.52 0 0 0 16 7.984z"
      ></path>
      <defs>
        <radialGradient
          id={gradientId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="matrix(16.1326 5.4553 -43.70045 129.2322 1.588 6.503)"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.067" stopColor="#9168C0"></stop>
          <stop offset="0.343" stopColor="#5684D1"></stop>
          <stop offset="0.672" stopColor="#1BA1E3"></stop>
        </radialGradient>
      </defs>
    </svg>
  );
}

function GoogleCloudIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" viewBox="0 -25 256 256">
      <path
        fill="#EA4335"
        d="m170.252 56.819 22.253-22.253 1.483-9.37C153.437-11.677 88.976-7.496 52.42 33.92 42.267 45.423 34.734 59.764 30.717 74.573l7.97-1.123 44.505-7.34 3.436-3.513c19.797-21.742 53.27-24.667 76.128-6.168z"
      ></path>
      <path
        fill="#4285F4"
        d="M224.205 73.918a100.25 100.25 0 0 0-30.217-48.722l-31.232 31.232a55.52 55.52 0 0 1 20.379 44.037v5.544c15.35 0 27.797 12.445 27.797 27.796 0 15.352-12.446 27.485-27.797 27.485h-55.671l-5.466 5.934v33.34l5.466 5.231h55.67c39.93.311 72.553-31.494 72.864-71.424a72.3 72.3 0 0 0-31.793-60.453"
      ></path>
      <path
        fill="#34A853"
        d="M71.87 205.796h55.593V161.29H71.87a27.3 27.3 0 0 1-11.399-2.498l-7.887 2.42-22.409 22.253-1.952 7.574c12.567 9.489 27.9 14.825 43.647 14.757"
      ></path>
      <path
        fill="#FBBC05"
        d="M71.87 61.426C31.94 61.663-.237 94.227.001 134.158a72.3 72.3 0 0 0 28.222 56.88l32.248-32.246c-13.99-6.322-20.208-22.786-13.887-36.776s22.786-20.208 36.775-13.888a27.8 27.8 0 0 1 13.887 13.888l32.248-32.248A72.22 72.22 0 0 0 71.87 61.427"
      ></path>
    </svg>
  );
}

function GroqIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      className="fill-foreground"
      viewBox="0 0 24 24"
    >
      <path
        fill="#F55036"
        d="M24 12c0 6.627-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0s12 5.373 12 12z"
      ></path>
      <path
        fill="#fff"
        d="M12.002 6a4.118 4.118 0 00-4.118 4.108 4.118 4.118 0 004.118 4.109h1.354v-1.541h-1.354a2.574 2.574 0 01-2.574-2.568 2.574 2.574 0 012.574-2.568c1.42 0 2.58 1.152 2.58 2.568v3.784a2.58 2.58 0 01-2.555 2.567 2.558 2.558 0 01-1.791-.752l-1.092 1.09a4.095 4.095 0 002.855 1.202l.028.001h.029a4.118 4.118 0 004.061-4.09l.002-3.903A4.119 4.119 0 0012.002 6z"
      ></path>
    </svg>
  );
}

function VoyageIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 32 32" aria-label="Voyage AI">
      <g fill="#1A1A1A">
        <path d="M16 4l-7.2 17.5h3.6l1.45-3.7h4.3l1.45 3.7H23.2L16 4zm-1.05 10.85L16 11.7l1.05 3.15h-2.1z" />
        <path d="M5.5 24h21v3h-21z" />
      </g>
    </svg>
  );
}

function XaiIcon() {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      style={{ flex: "none", lineHeight: "1" }}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Grok</title>
      <path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"></path>
    </svg>
  );
}

export const modelProviderIcons: Record<keyof typeof modelProviders, ReactNode> = {
  openai: <OpenAIIcon />,
  openai_codex: <CodexIcon />,
  azure: <AzureIcon />,
  anthropic: <AnthropicIcon />,
  elevenlabs: <ElevenLabsIcon />,
  groq: <GroqIcon />,
  vertex_ai: <GoogleCloudIcon />,
  gemini: <GeminiIcon />,
  // Deprecated fold-window provider: stored rows still render until the
  // migration folds them.
  google_agent_platform: <GoogleCloudIcon />,
  bedrock: <AWSIcon />,
  deepseek: <DeepSeekIcon />,
  custom: <CustomIcon />,
  xai: <XaiIcon />,
  cerebras: <CerebrasIcon />,
  voyage: <VoyageIcon />,
  azure_safety: <AzureIcon />,
};
