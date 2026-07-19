!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageviewId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

// api_host is the first-party reverse proxy served by the langwatch.ai
// deployment (same PostHog EU project); direct *.posthog.com requests get
// dropped by ad blockers, which our developer audience uses heavily. The
// docs live under langwatch.ai/docs, so production traffic is same-origin;
// Mintlify preview hosts send cross-origin, which PostHog's CORS allows.
// The snippet above derives the array.js URL from api_host, so the script
// also loads through the proxy (/ingest/static/array.js).
posthog.init('phc_oOlj3H19T2JlGbFXmrGrjSLbDPDNyPKYdIFaTdrkXOY', {
  api_host: 'https://langwatch.ai/ingest',
  ui_host: 'https://eu.posthog.com',
  person_profiles: 'always',
  // Mintlify navigates client-side after the first load; without this only
  // the session's landing page fires $pageview and every subsequent docs
  // page is invisible to analytics.
  capture_pageview: 'history_change',
});

// Handle all click interactions for custom components (event delegation)
// Mintlify RSC doesn't hydrate React onClick/useState/setTimeout,
// so everything runs from this global script via data attributes.
document.addEventListener('click', function(e) {
  // --- Accordion toggle (.lw-accordion-header) ---
  // The accordions are server-rendered divs (Mintlify strips <details>),
  // so open/close state lives on a data-open attribute driven from here.
  var accHeader = e.target.closest('.lw-accordion-header');
  if (accHeader) {
    var acc = accHeader.closest('.lw-accordion');
    if (acc) {
      var isOpen = acc.hasAttribute('data-open');
      if (isOpen) {
        acc.removeAttribute('data-open');
      } else {
        acc.setAttribute('data-open', 'true');
      }
      accHeader.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    }
  }

  // --- Copy to clipboard (data-copy) ---
  var copyEl = e.target.closest('[data-copy]');
  if (copyEl) {
    navigator.clipboard.writeText(copyEl.getAttribute('data-copy'));

    // Show "Copied!" state via data-copied on the button or the card
    var btn = copyEl.querySelector('.lw-copy-btn');
    var target = btn || copyEl;
    target.setAttribute('data-copied', 'true');
    setTimeout(function() { target.removeAttribute('data-copied'); }, 2000);
  }

  // --- Copy from a server-rendered source block (data-copy-source) ---
  // Long or non-ASCII texts (the full skill prompts) cannot live in data
  // attributes: Mintlify's server rendering drops those attribute values.
  // They ship as hidden fenced code blocks instead, and get copied from
  // the rendered code element's text.
  var copySourceEl = e.target.closest('[data-copy-source]');
  if (copySourceEl) {
    var sourceCode = copySourceEl.querySelector('.lw-prompt-source code');
    if (sourceCode) {
      navigator.clipboard.writeText(sourceCode.textContent.replace(/\n$/, ''));
      copySourceEl.setAttribute('data-copied', 'true');
      setTimeout(function() { copySourceEl.removeAttribute('data-copied'); }, 2000);
    }
  }

  // --- Download SKILL.md (data-download-url) ---
  var dlEl = e.target.closest('[data-download-url]');
  if (dlEl) {
    var rawUrl = dlEl.getAttribute('data-download-url');
    var name = dlEl.getAttribute('data-download-name') || 'SKILL.md';
    fetch(rawUrl)
      .then(function(r) {
        if (!r.ok) throw new Error('Download failed with status ' + r.status);
        return r.text();
      })
      .then(function(content) {
        var blob = new Blob([content], { type: 'text/markdown' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(function(err) {
        console.error('Failed to download SKILL.md', err);
      });
  }

  // --- PostHog tracking (data-track) ---
  var trackEl = e.target.closest('[data-track]');
  if (trackEl && window.posthog) {
    var event = trackEl.getAttribute('data-track');
    var props = {};
    Array.from(trackEl.attributes).forEach(function(attr) {
      if (attr.name.startsWith('data-track-')) {
        props[attr.name.replace('data-track-', '')] = attr.value;
      }
    });
    window.posthog.capture(event, props);
  }
});

// Keyboard support for the div-based accordion headers (role="button")
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (!e.target || !e.target.closest) return;
  var accHeader = e.target.closest('.lw-accordion-header');
  if (accHeader) {
    e.preventDefault();
    accHeader.click();
  }
});
