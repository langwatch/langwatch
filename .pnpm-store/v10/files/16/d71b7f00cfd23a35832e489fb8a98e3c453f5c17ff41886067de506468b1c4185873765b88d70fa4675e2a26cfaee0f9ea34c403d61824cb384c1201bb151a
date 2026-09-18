// src/middleware/language/language.ts
import { setCookie, getCookie } from "../../helper/cookie/index.js";
import { parseAccept } from "../../utils/accept.js";
var DEFAULT_OPTIONS = {
  order: ["querystring", "cookie", "header"],
  lookupQueryString: "lang",
  lookupCookie: "language",
  lookupFromHeaderKey: "accept-language",
  lookupFromPathIndex: 0,
  caches: ["cookie"],
  ignoreCase: true,
  fallbackLanguage: "en",
  supportedLanguages: ["en"],
  cookieOptions: {
    sameSite: "Strict",
    secure: true,
    maxAge: 365 * 24 * 60 * 60,
    httpOnly: true
  },
  debug: false
};
function parseAcceptLanguage(header) {
  return parseAccept(header).map(({ type, q }) => ({ lang: type, q }));
}
var normalizeLanguage = (lang, options) => {
  if (!lang) {
    return void 0;
  }
  try {
    let normalizedLang = lang.trim();
    if (options.convertDetectedLanguage) {
      normalizedLang = options.convertDetectedLanguage(normalizedLang);
    }
    const compLang = options.ignoreCase ? normalizedLang.toLowerCase() : normalizedLang;
    const compSupported = options.supportedLanguages.map(
      (l) => options.ignoreCase ? l.toLowerCase() : l
    );
    const exactIndex = compSupported.indexOf(compLang);
    if (exactIndex !== -1) {
      return options.supportedLanguages[exactIndex];
    }
    let longestMatchIndex = -1;
    let longestMatchLength = -1;
    for (let i = 0; i < compSupported.length; i++) {
      const candidate = compSupported[i];
      if (candidate.length < compLang.length && candidate.length > longestMatchLength && compLang.startsWith(candidate) && compLang[candidate.length] === "-") {
        longestMatchIndex = i;
        longestMatchLength = candidate.length;
      }
    }
    if (longestMatchIndex !== -1) {
      return options.supportedLanguages[longestMatchIndex];
    }
    return void 0;
  } catch {
    return void 0;
  }
};
var detectFromQuery = (c, options) => {
  const query = c.req.query(options.lookupQueryString);
  return normalizeLanguage(query, options);
};
var detectFromCookie = (c, options) => {
  const cookie = getCookie(c, options.lookupCookie);
  return normalizeLanguage(cookie, options);
};
function detectFromHeader(c, options) {
  try {
    const acceptLanguage = c.req.header(options.lookupFromHeaderKey);
    if (!acceptLanguage) {
      return void 0;
    }
    const languages = parseAcceptLanguage(acceptLanguage);
    for (const { lang } of languages) {
      const normalizedLang = normalizeLanguage(lang, options);
      if (normalizedLang) {
        return normalizedLang;
      }
    }
    return void 0;
  } catch {
    return void 0;
  }
}
function detectFromPath(c, options) {
  const url = new URL(c.req.url);
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const langSegment = pathSegments[options.lookupFromPathIndex];
  return normalizeLanguage(langSegment, options);
}
var detectors = {
  querystring: detectFromQuery,
  cookie: detectFromCookie,
  header: detectFromHeader,
  path: detectFromPath
};
function validateOptions(options) {
  if (!options.supportedLanguages.includes(options.fallbackLanguage)) {
    throw new Error("Fallback language must be included in supported languages");
  }
  if (options.lookupFromPathIndex < 0) {
    throw new Error("Path index must be non-negative");
  }
  if (!options.order.every((detector) => Object.keys(detectors).includes(detector))) {
    throw new Error("Invalid detector type in order array");
  }
}
function cacheLanguage(c, language, options) {
  if (!Array.isArray(options.caches) || !options.caches.includes("cookie")) {
    return;
  }
  try {
    setCookie(c, options.lookupCookie, language, options.cookieOptions);
  } catch (error) {
    if (options.debug) {
      console.error("Failed to cache language:", error);
    }
  }
}
var detectLanguage = (c, options) => {
  let detectedLang;
  for (const detectorName of options.order) {
    const detector = detectors[detectorName];
    try {
      detectedLang = detector(c, options);
      if (detectedLang) {
        if (options.debug) {
          console.log(`Language detected from ${detectorName}: ${detectedLang}`);
        }
        break;
      }
    } catch (error) {
      if (options.debug) {
        console.error(`Error in ${detectorName} detector:`, error);
      }
      continue;
    }
  }
  const finalLang = detectedLang || options.fallbackLanguage;
  if (detectedLang && options.caches) {
    cacheLanguage(c, finalLang, options);
  }
  return finalLang;
};
var languageDetector = (userOptions) => {
  const options = {
    ...DEFAULT_OPTIONS,
    ...userOptions,
    cookieOptions: {
      ...DEFAULT_OPTIONS.cookieOptions,
      ...userOptions.cookieOptions
    }
  };
  validateOptions(options);
  return async function languageDetector2(ctx, next) {
    const lang = detectLanguage(ctx, options);
    ctx.set("language", lang);
    await next();
  };
};
export {
  DEFAULT_OPTIONS,
  detectFromCookie,
  detectFromHeader,
  detectFromPath,
  detectFromQuery,
  detectors,
  languageDetector,
  normalizeLanguage,
  parseAcceptLanguage,
  validateOptions
};
