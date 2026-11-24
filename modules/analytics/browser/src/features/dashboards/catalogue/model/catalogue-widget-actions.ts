/**
 * What Langy is asked from each catalogue widget's card: the buttons under its chart and what a
 * click on one of its values drafts (dashboards-v2 AC243 to AC245). `{question}` is the card's
 * title, `{period}` the board's range in words and `{<kind>}` the clicked value.
 */

import type { WidgetAction } from "../../langy/model/board-langy.ts";

/** Keyed by catalogue widget id; a widget missing here offers no buttons and generic clicks. */
export const CATALOGUE_WIDGET_ACTIONS: Readonly<Record<string, readonly WidgetAction[]>> = {
  traffic: [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows my traffic moved sharply over {period}. Find what drove it: which ' +
        "topics, customers or sources grew or fell, and whether it is real use or test " +
        "traffic. Give me the top 3 reasons with numbers.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", what made {day} different from the rest of {period}? Tell me which ' +
        "topics, customers or sources made up that day, how it compares with a usual day, and " +
        "show me 3 example requests from it.",
    },
  ],
  "conversation-length": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows conversations got longer over {period}. Find out whether people ' +
        "need more turns because the first answers miss. Show me the 3 conversations that " +
        "show it best and tell me what the agent got wrong in each.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", why were conversations on {day} longer or shorter than usual? Show ' +
        "me the 3 longest conversations of that day and tell me where each one went in " +
        "circles.",
    },
  ],
  topics: [
    {
      kind: "click",
      on: "topic",
      prompt:
        'On "{question}", tell me about the topic "{topic}" over {period}: what people ask ' +
        "exactly, how well my agent answers it, and 3 example conversations. End with one " +
        "thing I could improve for this topic.",
    },
  ],
  "fd-throughput": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows slower answers or more errors over {period}. Find whether they ' +
        "follow traffic peaks or start on their own, which step or model causes them, and " +
        "show me the 3 requests that show it best.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", what happened on {day}? Compare its volume, response time and ' +
        "errors with a usual day, name the cause of anything unusual, and show me 3 requests " +
        "from that day.",
    },
  ],
  "ask-rising": [
    {
      kind: "click",
      on: "topic",
      prompt:
        'On "{question}", why are people asking more about "{topic}" in {period}? Show me 3 ' +
        "example conversations, tell me whether my agent answers them well, and what I should " +
        "add if it does not.",
    },
  ],
  "att-share": [
    {
      kind: "click",
      on: "customer",
      prompt:
        'On "{question}", tell me how {customer} uses my agent over {period}: what they ask ' +
        "about, how well it goes for them, and what it costs. Show me 3 example " +
        "conversations.",
    },
  ],
  "ck-kpis": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows a number got worse than the period before ({period}). Find out ' +
        "why that number moved, which topics or customers drove it, and show me the 3 " +
        "requests that show it best.",
    },
  ],
  "ck-attention": [
    {
      kind: "investigate",
      shown: "always",
      prompt:
        '"{question}" names one problem for {period}. Dig into it: confirm it with real ' +
        "conversations, tell me since when it happens and the most likely cause. Show me the " +
        "3 requests that show it best.",
    },
    {
      kind: "propose-fix",
      shown: "always",
      prompt:
        'For the problem "{question}" names over {period}, propose one concrete fix: a prompt ' +
        "change, an added check or a code change. Test it on the failing conversations before " +
        "you show it to me, and change nothing until I agree.",
    },
  ],
  "ck-top-ask": [
    {
      kind: "investigate",
      shown: "always",
      prompt:
        '"{question}" names a request my agent cannot serve over {period}. Show me 5 real ' +
        "conversations asking for it, how my agent replies today, and how many users it " +
        "affects.",
    },
    {
      kind: "propose-fix",
      shown: "always",
      prompt:
        'For the request "{question}" names, propose how my agent should handle it: either a ' +
        "prompt change so it says clearly what it cannot do and where to go, or the tool or " +
        "content it would need. Draft the prompt change and test it on the 5 conversations; " +
        "change nothing until I agree.",
    },
  ],
  "ck-trend": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows fewer conversations resolved over {period}. Check whether the ' +
        "drop starts at a prompt, model or deploy change, and show me the 3 requests that " +
        "show it best that did not resolve after it.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", why did fewer or more conversations resolve on {day}? Tell me ' +
        "whether a change happened around then and show me 3 unresolved conversations from " +
        "that day.",
    },
  ],
  "ans-outcomes": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows more conversations ending badly over {period}. Find which bad ' +
        "ending grew, on which topics, and show me the 3 requests that show it best.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'Take the bad ending that grew most on "{question}" over {period} and propose a ' +
        "prompt change that would avoid it. Test it on the affected conversations and show me " +
        "before and after; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      series: "outcome",
      prompt:
        'On "{question}", show me 3 conversations that ended as "{outcome}" on {day} and tell ' +
        "me what they have in common.",
    },
  ],
  "ans-topics": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows topics my agent handles badly over {period}. Take the weakest ' +
        "topic, show me 3 conversations that went wrong and tell me what goes wrong in each.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the weakest topic on "{question}" over {period}, propose a prompt change or the ' +
        "content to add. Test the prompt change on the failing conversations; change nothing " +
        "until I agree.",
    },
    {
      kind: "click",
      on: "topic",
      prompt:
        'On "{question}", why does my agent struggle with "{topic}"? Show me 3 conversations ' +
        "that went wrong and what to change.",
    },
  ],
  "ask-cannot": [
    {
      kind: "investigate",
      shown: "always",
      prompt:
        '"{question}" shows what users want that my agent cannot do over {period}. Rank these ' +
        "requests by how many users ask, with 2 example conversations each, so I can decide " +
        "what to build.",
    },
    {
      kind: "click",
      on: "topic",
      prompt:
        'On "{question}", what exactly do users ask for in "{topic}"? Show me 3 conversations ' +
        "and what my agent would need (a tool or content) to serve them.",
    },
  ],
  "att-table": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows a customer whose pass rate fell over {period}. Find what went ' +
        "wrong for them and show me the 3 requests that show it best.",
    },
    {
      kind: "click",
      on: "customer",
      prompt:
        'On "{question}", how does my agent do for {customer} over {period}? Tell me what ' +
        "they ask, where it fails them and what it costs, with 3 example conversations.",
    },
  ],
  "voice-task-success": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows a language where fewer calls get the job done over {period}. Find ' +
        "why: speech recognition, the answers or the hand-off. Show me the 3 calls that show " +
        "it best.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the weakest language on "{question}", propose a prompt change for that language ' +
        "and test it on its failed calls; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "language",
      prompt:
        'On "{question}", why do calls in {language} fail more or less often over {period}? ' +
        "Show me 3 failed calls in {language} and what went wrong.",
    },
  ],
  "ext-human-review": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows more documents going to a person over {period}. Find which ' +
        "document type and which field send them there and show me 3 documents.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the document type that goes to review most on "{question}", propose a prompt ' +
        "change for the field that fails most, and test it on the reviewed documents; change " +
        "nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", why did more or fewer documents go to a person on {day}? Show me 3 ' +
        "of them and the field that failed.",
    },
  ],
  "gen-acceptance": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows users editing or redoing more of what my agent writes over ' +
        "{period}. Find what they change and show me 3 outputs with the user's edit next to " +
        "them.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'From what users edit on "{question}" over {period}, propose a prompt change so the ' +
        "first draft needs less editing. Test it on the edited outputs; change nothing until " +
        "I agree.",
    },
    {
      kind: "click",
      on: "action",
      prompt:
        'On "{question}", show me 3 outputs users marked as "{action}" over {period} and what ' +
        "they have in common.",
    },
  ],
  "gen-dropoff": [
    {
      kind: "investigate",
      shown: "always",
      prompt:
        '"{question}" shows the step where users drop what my agent wrote over {period}. Show ' +
        "me 3 outputs that were dropped at the biggest step and tell me why they were not " +
        "used.",
    },
    {
      kind: "click",
      on: "step",
      prompt:
        'On "{question}", why do outputs drop at "{step}"? Show me 3 examples and what would ' +
        "make users keep them.",
    },
  ],
  "satisfaction-shift": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows satisfaction fell over {period}. Find which topics or changes ' +
        "drove it and show me the 3 least satisfied conversations with what went wrong.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", why was satisfaction on {day} different from usual? Show me the 3 ' +
        "least satisfied conversations of that day.",
    },
  ],
  "ask-again": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows more users asking again over {period}. Show me 3 conversations ' +
        "where the user had to rephrase, what the first answer missed, and the topic it " +
        "happens on most.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'From the conversations on "{question}" over {period}, propose a prompt change so the ' +
        "first answer lands. Test it on those first questions and show me before and after; " +
        "change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", show me 3 conversations from {day} where the user had to ask again, ' +
        "and what the first answer missed.",
    },
  ],
  "thumbs-down": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows answers marked down over {period}. Group them by what went wrong ' +
        "and show me one example of each group.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'From the answers marked down on "{question}" over {period}, propose one prompt ' +
        "change that fixes the most common problem and test it on those answers. Also offer " +
        "to add them to a test dataset; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "answer",
      prompt:
        'On "{question}", tell me what went wrong in this answer ({answer}) and how the agent ' +
        "should have answered.",
    },
  ],
  "lowest-scores": [
    {
      kind: "investigate",
      shown: "always",
      prompt:
        '"{question}" lists the worst-scored answers over {period}. Tell me what they have in ' +
        "common and whether the check scored them fairly.",
    },
    {
      kind: "propose-fix",
      shown: "always",
      prompt:
        'From the answers on "{question}" over {period}, propose a prompt change for the most ' +
        "common problem and test it on them; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "answer",
      prompt:
        'On "{question}", explain why this answer ({answer}) scored low and what a good ' +
        "answer would say.",
    },
  ],
  "fd-quality": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows checks passing less over {period}. Find whether it follows errors ' +
        "or a change, which check drops most, and show me the 3 requests that show it best.",
    },
    {
      kind: "click",
      on: "series",
      prompt:
        'On "{question}", what drove the {series} line over {period}? Point me to the day it ' +
        "moved most and 3 requests from that day.",
    },
  ],
  "fd-feedback": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows reviewers liking fewer answers over {period}. Group the thumbs ' +
        "down by what went wrong and show me one example of each.",
    },
    {
      kind: "click",
      on: "series",
      prompt:
        'On "{question}", show me 3 answers reviewers marked "{series}" over {period} and ' +
        "what they have in common.",
    },
  ],
  "ans-evaluators": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows a check under its line over {period}. Show me 3 answers that ' +
        "failed it and tell me whether the answers or the check are wrong.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the check that fails most on "{question}" over {period}, propose a fix: a prompt ' +
        "change if the answers are wrong, or a change to the check if it is too strict. Test " +
        "it on the failures; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      series: "check",
      prompt:
        'On "{question}", why did the check "{check}" fail on {day}? Show me 3 failed answers ' +
        "from that day.",
    },
  ],
  "ans-idk": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows topics where my agent gives no answer over {period}. For the top ' +
        "topic, show me 3 conversations and tell me whether content is missing or the agent " +
        "refuses too easily.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the top topic on "{question}", propose a fix: a prompt change if it refuses too ' +
        "easily, or a list of content to add if it lacks it. Test the prompt change on those " +
        "conversations; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "topic",
      prompt:
        'On "{question}", why does my agent fail to answer about "{topic}"? Show me 3 ' +
        "conversations and what it would need.",
    },
  ],
  "ans-review": [
    {
      kind: "click",
      on: "conversation",
      prompt:
        'On "{question}", review this conversation ({conversation}) with me: what went wrong, ' +
        "whether the automatic check got it right, and whether it should go into my test " +
        "dataset.",
    },
  ],
  "so-rubric": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows a policy check under my minimum over {period}. Show me 3 answers ' +
        "that failed it and what they got wrong.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the policy check under my minimum on "{question}", propose a prompt change that ' +
        "fixes it and test it on the failed answers; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "check",
      prompt:
        'On "{question}", show me 3 answers that failed "{check}" over {period} and what they ' +
        "got wrong.",
    },
  ],
  "rag-failure-source": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows failures over {period}. For the larger cause, show me 3 failed ' +
        "questions with what the search found and what the answer said.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the larger cause on "{question}": if the search is at fault, list the content to ' +
        "add or the search setting to change; if the answer is at fault, draft a prompt " +
        "change and test it on the failed questions; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      series: "cause",
      prompt:
        'On "{question}", show me 3 failures on {day} caused by "{cause}" and what went wrong ' +
        "in each.",
    },
  ],
  "rag-empty-retrieval": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows searches finding nothing over {period}. Group the questions ' +
        "behind it by subject, show me 3 examples, and tell me whether content is missing or " +
        "the search query is bad.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'From the empty searches on "{question}" over {period}, list the content to add by ' +
        "subject, and if the search query itself is bad, draft a change to how the question " +
        "is rewritten; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", which questions found nothing on {day}? Show me 3 and what content ' +
        "would answer them.",
    },
  ],
  "ext-field-accuracy": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows fields my agent gets wrong over {period}. For the worst field, ' +
        "show me 3 documents with the wrong value next to the right one.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the worst field on "{question}", propose a prompt change for that field and test ' +
        "it on the documents it got wrong; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "field",
      series: "document type",
      prompt:
        'On "{question}", why does my agent get "{field}" wrong on {document type}? Show me 3 ' +
        "documents.",
    },
  ],
  "latency-slo": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows slow periods over {period}. Find which step, model or tool made ' +
        "them slow and show me the 3 requests that show it best.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", why was {day} slower than usual? Name the step or model behind it ' +
        "and show me the 3 slowest requests.",
    },
  ],
  "error-rate": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows more requests ending in an error over {period}. Find which errors ' +
        "grew, since when, and whether a change started them. Show me the 3 requests that " +
        "show it best and the most likely cause.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the error that grew most on "{question}" over {period}, propose a fix: a code ' +
        "change through a pull request (retry, timeout, input check) or a prompt change if " +
        "the model causes it. Change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", what errors happened on {day}? Group them by type, compare with a ' +
        "usual day and show me 3 failed requests.",
    },
  ],
  "latency-spread": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows a long gap between typical and slowest answers over {period}. ' +
        "Find what the slowest requests have in common and show me 3 of them.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", why were the slowest answers on {day} so slow? Show me 3 and the ' +
        "step that took the time.",
    },
  ],
  "slowest-models": [
    {
      kind: "click",
      on: "model",
      prompt:
        'On "{question}", why is {model} slow for my agent over {period}? Tell me whether it ' +
        "is the model, long inputs or a step around it, and whether a faster model would hold " +
        "quality.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'From "{question}" over {period}, propose a faster model for the slowest one and run ' +
        "it against my test scenarios to check quality, cost and speed; change nothing until " +
        "I agree.",
    },
  ],
  "fd-failures": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" lists my agent\'s errors over {period}. For the most frequent one, tell ' +
        "me since when it happens, which step throws it, and the most likely cause, with 3 " +
        "example requests.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the most frequent error on "{question}", propose a code change through a pull ' +
        "request that stops it or handles it; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "error",
      prompt:
        'On "{question}", explain the error "{error}": where it happens, since when, the most ' +
        "likely cause, and 3 example requests.",
    },
  ],
  "ck-status": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows errors or response time worse than a typical day. Find what is ' +
        "wrong right now, since when, and show me the 3 requests that show it best.",
    },
  ],
  "up-errors": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows an error spike over {period}. Check whether it starts at a ' +
        "prompt, model or deploy change, name the change, and show me 3 failed requests.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the error spike on "{question}": if a change started it, propose rolling that ' +
        "change back or a fix through a pull request; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      series: "error type",
      prompt:
        'On "{question}", what caused "{error type}" on {day}? Tell me whether a change ' +
        "around then started it, with 3 example requests.",
    },
  ],
  "up-where-fails": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows the step or tool that fails most over {period}. For the one with ' +
        "most failures that reached users, show me 3 requests and the most likely cause.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the step on "{question}" with most failures that reached users, propose a code ' +
        "change through a pull request: a retry, a fallback or a fix of the input; change " +
        "nothing until I agree.",
    },
    {
      kind: "click",
      on: "step",
      prompt:
        'On "{question}", why does "{step}" fail over {period}? Show me 3 failures and ' +
        "whether my agent recovered from them.",
    },
  ],
  "up-failing-traces": [
    {
      kind: "click",
      on: "request",
      prompt:
        'On "{question}", walk me through this request ({request}): which step broke or was ' +
        "slow, and why.",
    },
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" lists failed and slow requests over {period}. Tell me what they have in ' +
        "common and which single cause would fix most of them.",
    },
  ],
  "up-step-latency": [
    {
      kind: "investigate",
      shown: "always",
      prompt:
        '"{question}" shows which step takes the time over {period}. For the slowest step, ' +
        "show me 3 slow requests and what makes it slow.",
    },
    {
      kind: "click",
      on: "step",
      prompt:
        'On "{question}", why is "{step}" slow? Show me its 3 slowest runs and how to make it ' +
        "faster.",
    },
  ],
  "up-loops": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows my agent repeating itself over {period}. Show me the 3 worst ' +
        "loops, which tool or step repeats, and what they cost.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the step that loops most on "{question}", propose a fix: a cap on retries ' +
        "through a pull request, or a prompt change so the agent stops repeating the same " +
        "call; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", show me the loops on {day}: which tool repeated, how many times, ' +
        "and what it cost.",
    },
  ],
  "voice-turn-latency": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows slow replies over {period}. Find which stage grew (speech to ' +
        "text, thinking or text to speech) and show me 3 slow calls.",
    },
    {
      kind: "click",
      on: "day",
      series: "stage",
      prompt: 'On "{question}", why was "{stage}" slow on {day}? Show me 3 slow replies.',
    },
  ],
  "voice-call-health": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows more dropped calls or repeats over {period}. Show me 3 calls that ' +
        "dropped or repeated and what happened just before.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", show me the calls that dropped or repeated on {day} and what ' +
        "happened just before.",
    },
  ],
  "tools-error-rate": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows tools failing over {period}. For the tool with most failures that ' +
        "reached users, show me 3 failed calls and the most likely cause.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the worst tool on "{question}", propose a fix: a code change through a pull ' +
        "request (input check, retry, fallback) or a clearer tool description if the agent " +
        "calls it wrong; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "tool",
      prompt:
        'On "{question}", why does the tool "{tool}" fail over {period}? Show me 3 failed ' +
        "calls and whether my agent recovered.",
    },
  ],
  "tools-wrong-tool": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows my agent picking the wrong tool over {period}. Show me 3 tasks ' +
        "where it did, which tool it should have picked, and why it got confused.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'From the wrong picks on "{question}", propose clearer tool descriptions and test ' +
        "them on those tasks; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", show me 3 tasks from {day} where my agent picked the wrong tool ' +
        "first.",
    },
  ],
  scenarios: [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows test scenarios failing more over {period}. Tell me which ' +
        "scenarios started failing, since which run, and what changed.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the scenario that started failing on "{question}", propose a prompt or code ' +
        "change that makes it pass again, and run the scenarios to prove it; change nothing " +
        "until I agree.",
    },
    {
      kind: "click",
      on: "day",
      prompt: 'On "{question}", which scenarios failed on {day} and why?',
    },
  ],
  "ship-verdict": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows scenarios that got worse in the new version. For each, show me ' +
        "the failing run next to the passing one and tell me what changed.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the scenarios that got worse on "{question}", propose a prompt or code change ' +
        "and rerun them to prove the fix; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "scenario",
      prompt:
        'On "{question}", why did the scenario "{scenario}" get worse in the new version? ' +
        "Show me both runs side by side.",
    },
  ],
  "ship-compare": [
    {
      kind: "click",
      on: "run",
      prompt:
        'On "{question}", what changed in the run {run} against my baseline: which scenarios ' +
        "got better or worse, and why?",
    },
  ],
  "ship-suites": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows a suite whose CI runs fail more over {period}. Tell me which ' +
        "scenarios fail, since which commit or change, and why.",
    },
    {
      kind: "click",
      on: "suite",
      prompt:
        'On "{question}", why does the suite "{suite}" fail? Show me its failing scenarios ' +
        "and the change that started it.",
    },
  ],
  "ship-rollout": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows production got worse after my last change. Tell me which number ' +
        "moved, on which topics, and show me the 3 requests that show it best.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'Production got worse after my last change on "{question}". Propose either rolling ' +
        "the change back or a fix for what it broke, tested on the affected requests; change " +
        "nothing until I agree.",
    },
  ],
  "att-change": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows customers my last change broke. For the worst one, show me 3 ' +
        "conversations before and after the change and what broke.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the customers my last change broke on "{question}", propose a fix or a rollback, ' +
        "tested on their conversations; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "customer",
      prompt:
        'On "{question}", what did my last change break for {customer}? Show me 3 ' +
        "conversations before and after.",
    },
  ],
  "so-verdict": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows a red figure for this release. Explain what blocks sign-off, with ' +
        "the items behind it.",
    },
    {
      kind: "click",
      on: "control",
      prompt:
        'On "{question}", explain "{control}" this week against last week, and show me the ' +
        "items it flagged.",
    },
  ],
  "so-changes": [
    {
      kind: "click",
      on: "change",
      prompt:
        'On "{question}", what did the change "{change}" do to my agent? Compare quality, ' +
        "errors, speed and cost in the days before and after it.",
    },
  ],
  "ext-precision-recall": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows the latest run finding fewer fields or getting more wrong. Show ' +
        "me 3 documents where it got worse and which fields.",
    },
    {
      kind: "click",
      on: "run",
      prompt:
        'On "{question}", what changed in the run {run}? Show me the fields it missed or got ' +
        "wrong against the run before.",
    },
  ],
  "lowest-passing-evaluators": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows checks that fail most over {period}. For the worst one, show me 3 ' +
        "failures and tell me whether the answers are wrong or the check is too strict.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the worst check on "{question}", propose a fix: a prompt change if the answers ' +
        "are wrong, or an adjusted check if it is too strict. Test it on the failures; change " +
        "nothing until I agree.",
    },
    {
      kind: "click",
      on: "check",
      prompt:
        'On "{question}", why does the check "{check}" fail so often? Show me 3 failures and ' +
        "whether the check got them right.",
    },
  ],
  "evaluation-coverage": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows how much of my traffic is checked over {period}. Tell me which ' +
        "kinds of requests no check covers and which matter most.",
    },
    {
      kind: "propose-fix",
      label: "Add a check",
      shown: "problem",
      prompt:
        'From "{question}", propose one automatic check for the most important requests that ' +
        "nothing checks today, with the rule it applies and a test on 20 real requests; " +
        "change nothing until I agree.",
    },
  ],
  "ship-flaky": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows scenarios that flip between pass and fail. For the worst one, ' +
        "show me a passing and a failing run side by side and tell me what makes it unstable.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the flakiest scenario on "{question}", propose a fix to the scenario itself ' +
        "(clearer criteria or a fixed input) and run it 5 times to show it is stable; change " +
        "nothing until I agree.",
    },
    {
      kind: "click",
      on: "scenario",
      prompt:
        'On "{question}", why does the scenario "{scenario}" flip? Compare a passing and a ' +
        "failing run.",
    },
  ],
  "so-agreement": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows an automatic check agreeing less with reviewers over {period}. ' +
        "Show me 3 cases where they disagree and who is right.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the check that disagrees with reviewers on "{question}", propose a change to its ' +
        "instructions and test it on the reviewed cases; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "check",
      prompt:
        'On "{question}", show me where the check "{check}" and reviewers disagree, and who ' +
        "is right.",
    },
  ],
  "rag-dataset-versions": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows my test set drifting from what users ask. Tell me which topics ' +
        "users ask now that the test set misses.",
    },
    {
      kind: "propose-fix",
      label: "Update the test set",
      shown: "problem",
      prompt:
        'From "{question}", propose new test cases from real questions on the topics my test ' +
        "set misses, ready to add as a new version; change nothing until I agree.",
    },
  ],
  "so-queue": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows the review queue growing over {period}. Tell me what fills it, ' +
        "whether a check flags too much, and how long items wait.",
    },
    {
      kind: "click",
      on: "day",
      prompt: 'On "{question}", what was flagged for review on {day}, and why?',
    },
  ],
  "token-drift": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows token use drifting up over {period}. Find what grew: longer ' +
        "prompts, longer answers, more steps or a new feature. Show me the 3 requests that " +
        "show it best.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'From what grew on "{question}", propose a prompt change that cuts tokens without ' +
        "hurting answers, and test it on real requests to show quality and tokens before and " +
        "after; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", why did my agent use more or fewer tokens on {day}? Show me the 3 ' +
        "requests that used the most.",
    },
  ],
  spend: [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows my spend jumped over {period}. Find what drove it: which model, ' +
        "feature, customer or test runs, and since when.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", why did I spend more or less on {day}? Split it by model and source ' +
        "and show me the 3 most expensive requests.",
    },
  ],
  "top-models": [
    {
      kind: "click",
      on: "model",
      prompt:
        'On "{question}", what does my agent use {model} for over {period}, what does it ' +
        "cost, and is there a cheaper model that would do as well?",
    },
  ],
  "fd-cost-efficiency": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows the cost of one request without an error rose over {period}. Find ' +
        "whether more requests fail or each one costs more, and which model drives it.",
    },
    {
      kind: "click",
      on: "model",
      prompt:
        'On "{question}", why does {model} cost so much per request? Tell me what it is used ' +
        "for and whether a cheaper model would hold quality.",
    },
    {
      kind: "click",
      on: "outcome",
      prompt:
        'On "{question}", a request without an error is not proof the answer was right. Help ' +
        "me record how each conversation ended: turn on the conversation outcome judge, or " +
        "find where my code finishes a conversation and send how it ended (resolved, handed to " +
        "a person, could not do it, refused) as the outcome on its last request. Propose the " +
        "change; change nothing until I agree.",
    },
  ],
  "fd-gateway": [
    {
      kind: "click",
      on: "key",
      prompt:
        'On "{question}", what does the key {key} spend on over {period}: which models, which ' +
        "apps, and is anything unusual?",
    },
  ],
  "cost-verdict": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows I may go over budget this month. Find what drives the pace and ' +
        "which spend I can cut first.",
    },
  ],
  "cost-by-source": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows testing takes a large share of my spend over {period}. Tell me ' +
        "which evaluations or simulations cost most and how to cut them.",
    },
    {
      kind: "click",
      on: "source",
      prompt:
        'On "{question}", what is in my {source} spend over {period}? Show me the most ' +
        "expensive runs.",
    },
  ],
  "cost-by-model": [
    {
      kind: "propose-fix",
      label: "Try a cheaper model",
      shown: "problem",
      prompt:
        'From "{question}", pick the model that costs more than its share of traffic and test ' +
        "a cheaper one on my scenarios: show quality, cost and speed side by side; change " +
        "nothing until I agree.",
    },
    {
      kind: "click",
      on: "model",
      prompt:
        'On "{question}", why does {model} cost me this much over {period}? What is it used ' +
        "for, and would a cheaper model do?",
    },
  ],
  "cost-waste": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows wasted spend over {period}. For the biggest line, show me 3 ' +
        "requests that wasted money and why.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the biggest waste line on "{question}", propose a fix: a cap on retries or loops ' +
        "through a pull request, or a prompt change, and estimate what it saves; change " +
        "nothing until I agree.",
    },
    {
      kind: "click",
      on: "line",
      prompt: 'On "{question}", show me 3 requests behind "{line}" and how to stop that waste.',
    },
  ],
  "cost-by-segment": [
    {
      kind: "click",
      on: "customer or team",
      prompt:
        'On "{question}", why does {customer or team} cost this much over {period}? Tell me ' +
        "what they use, which models, and whether the cost is in line with their use.",
    },
  ],
  "voice-cost-per-call": [
    {
      kind: "click",
      on: "part",
      prompt:
        'On "{question}", what drives the {part} cost per call over {period}, and how could I ' +
        "lower it?",
    },
  ],
  "ext-cost-per-doc": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows the cost per document rose over {period}. Find whether a model ' +
        "change or longer documents caused it.",
    },
    {
      kind: "click",
      on: "model",
      prompt:
        'On "{question}", what does a document cost on {model}, and how accurate is it ' +
        "against the others?",
    },
  ],
  "ship-models": [
    {
      kind: "propose-fix",
      label: "Switch model",
      shown: "problem",
      prompt:
        'From "{question}", pick the cheapest model that keeps quality and propose switching ' +
        "to it, with the test run that proves it; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "model",
      prompt:
        'On "{question}", how did {model} do in my test runs: where it passed, where it ' +
        "failed, and what it would save?",
    },
  ],
  "data-health": [
    {
      kind: "propose-fix",
      label: "Fill the gaps",
      shown: "problem",
      prompt:
        '"{question}" shows some of my requests miss information LangWatch needs. For each ' +
        "missing piece, tell me in plain words what it is, then open a pull request on my " +
        "agent's code that sends it; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "field",
      value: "model",
      prompt:
        'On "{question}", {field} in {period} reach LangWatch without the model\'s name. Find ' +
        "where my code calls the model and change the LangWatch setup so every model call " +
        "records which model it used. Propose the code change.",
    },
    {
      kind: "click",
      on: "field",
      value: "cost",
      prompt:
        'On "{question}", {field} in {period} reach LangWatch with no token counts, so ' +
        "LangWatch can't work out their cost. Find where my code calls the model and record " +
        "the token usage from the model's response on each call. Propose the code change.",
    },
    {
      kind: "click",
      on: "field",
      value: "conversation",
      prompt:
        'On "{question}", my agent\'s requests reach LangWatch without a conversation id, so ' +
        "every message counts as its own conversation. Find where my code handles an incoming " +
        "message, take the id my app already uses for that chat (session, thread or " +
        "conversation id) and send it to LangWatch as the conversation id (thread_id) on " +
        "every request. Propose the code change.",
    },
    {
      kind: "click",
      on: "field",
      value: "user",
      prompt:
        "On \"{question}\", my agent's requests reach LangWatch without a user id, so I can't " +
        "see who uses my agent or who comes back. Find where my code knows the signed-in user " +
        "and send their id to LangWatch as the user id (user_id) on every request. Send an id " +
        "only, never a name or an email. Propose the code change.",
    },
    {
      kind: "click",
      on: "field",
      value: "labels",
      prompt:
        'On "{question}", I want to split my LangWatch dashboards by customer and by feature. ' +
        "Find where my code knows which customer a request belongs to and send that id as the " +
        "customer id (customer_id), and add labels for the feature or flow the request came " +
        "from. Propose the code change.",
    },
    {
      kind: "click",
      on: "field",
      value: "outcome",
      prompt:
        'On "{question}", find the place in my code where a conversation or task finishes, and ' +
        "send how it ended (resolved, handed to a person, could not do it, refused) to " +
        "LangWatch as the outcome on that conversation's last request. Propose the code change.",
    },
  ],
  noise: [
    {
      kind: "propose-fix",
      label: "Separate test traffic",
      shown: "problem",
      prompt:
        '"{question}" shows test and staging traffic mixed with real traffic over {period}. ' +
        "Propose how to keep it apart: a pull request that marks the environment on each " +
        "request, and a filter for my dashboards; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "source",
      prompt:
        'On "{question}", where does the "{source}" traffic come from, and should it count in ' +
        "my numbers?",
    },
  ],
  "cost-accuracy": [
    {
      kind: "propose-fix",
      label: "Add prices",
      shown: "problem",
      prompt:
        '"{question}" shows models with no price over {period}. Find the current price of ' +
        "each and set it in LangWatch so my cost figures are complete; change nothing until I " +
        "agree.",
    },
    {
      kind: "click",
      on: "model",
      prompt:
        'On "{question}", what is the price of {model} and how much spend is missing because ' +
        "of it?",
    },
  ],
  "fd-coding-agents": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows a coding agent whose cost or errors rose over {period}. Find ' +
        "which teams or tasks drive it and show me 3 sessions.",
    },
    {
      kind: "click",
      on: "agent",
      prompt:
        'On "{question}", how is {agent} used over {period}: by whom, for what, what it costs ' +
        "and how often its sessions hit an error?",
    },
  ],
  "ai-tools": [
    {
      kind: "click",
      on: "tool",
      prompt: 'On "{question}", who uses {tool} over {period}, how much, and what does it cost?',
    },
  ],
  "me-burn-summary": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows I am spending faster than usual over {period}. Find which ' +
        "sessions, repos or models drive it.",
    },
  ],
  "me-expensive-sessions": [
    {
      kind: "click",
      on: "session",
      prompt:
        'On "{question}", why did the session {session} cost so much? Tell me where the ' +
        "tokens went and what I could do differently next time.",
    },
  ],
  "me-by-pr": [
    {
      kind: "click",
      on: "pull request",
      prompt:
        'On "{question}", where did the tokens for {pull request} go: which sessions, tools ' +
        "and models?",
    },
  ],
  "me-spend-by-model": [
    {
      kind: "propose-fix",
      label: "Use a cheaper model",
      shown: "problem",
      prompt:
        'From "{question}" over {period}, find work I run on an expensive model that a ' +
        "cheaper one could do (for example subagents or simple edits) and propose a change to " +
        "my coding agent settings as a pull request; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "day",
      series: "model",
      prompt:
        'On "{question}", what did I use {model} for on {day}, and could a cheaper model have ' +
        "done it?",
    },
  ],
  "me-pace": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows I am spending faster than a typical week. Tell me which days and ' +
        "sessions drove it.",
    },
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", why did I spend more on {day}? Show me the 3 most expensive ' +
        "sessions.",
    },
  ],
  "me-cache-gauge": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows little of my input comes from the cache over {period}. Find what ' +
        "breaks caching in my sessions.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'From "{question}", propose a change to my coding setup that keeps the cache working ' +
        "(for example what changes at the start of each turn), as a pull request; change " +
        "nothing until I agree.",
    },
  ],
  "me-tool-round-trips": [
    {
      kind: "propose-fix",
      label: "Trim tool output",
      shown: "problem",
      prompt:
        'From "{question}", take the tool calls that return the most tokens and propose ' +
        "filtering or paging them, as a pull request on my coding setup; change nothing until " +
        "I agree.",
    },
    {
      kind: "click",
      on: "tool call",
      prompt: 'On "{question}", why did {tool call} send so many tokens, and how could I trim it?',
    },
  ],
  "me-main-vs-sub": [
    {
      kind: "click",
      on: "day",
      prompt:
        'On "{question}", what ran in my main conversation and in subagents on {day}, and ' +
        "which subagents used the most?",
    },
  ],
  "me-leaks": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows where my coding agents waste money over {period}. For the biggest ' +
        "one, show me 3 sessions where it happened.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'For the biggest waste on "{question}", propose the change to my coding setup that ' +
        "stops it, as a pull request, with what it would save; change nothing until I agree.",
    },
    {
      kind: "click",
      on: "rule",
      prompt: 'On "{question}", show me the sessions behind "{rule}" and what to change.',
    },
  ],
  "me-value-per-token": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows the cost of one merged pull request rising over {period}. Find ' +
        "what made recent ones more expensive.",
    },
  ],
  "me-shipping-calendar": [
    {
      kind: "click",
      on: "day",
      prompt: 'On "{question}", what did I merge on {day} and what did it cost?',
    },
  ],
  "me-cost-per-pr": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows pull requests that cost far more than usual. For the worst, tell ' +
        "me where the money went.",
    },
    {
      kind: "click",
      on: "pull request",
      prompt:
        'On "{question}", why did {pull request} cost far more than usual? Tell me where the ' +
        "tokens went.",
    },
  ],
  "me-babysit": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows pull requests costing a lot after they opened. Find whether CI ' +
        "retries or review fixes drive it, with the 3 worst.",
    },
  ],
  "me-pr-leaderboard": [
    {
      kind: "click",
      on: "pull request",
      prompt:
        'On "{question}", where did the money for {pull request} go: which sessions, tools ' +
        "and models?",
    },
  ],
  "me-output-vs-spend": [
    {
      kind: "click",
      on: "week",
      prompt: 'On "{question}", what did I ship in the week of {week} against what I spent?',
    },
  ],
  "me-gantt": [
    {
      kind: "click",
      on: "session",
      prompt: 'On "{question}", what did {session} do today, and how long did it wait on me?',
    },
  ],
  "me-waiting-on-you": [
    {
      kind: "click",
      on: "session",
      prompt:
        'On "{question}", what was {session} waiting for, and could it have gone on without ' +
        "me?",
    },
  ],
  "me-overnight": [
    {
      kind: "click",
      on: "session",
      prompt: 'On "{question}", what did {session} do overnight, and did it finish?',
    },
  ],
  "me-context-per-call": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows my context often above the 450k line over {period}. Find which ' +
        "sessions carry it and why.",
    },
  ],
  "me-compaction": [
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'From "{question}", propose a context size to compact at and the change to my coding ' +
        "setup that does it, as a pull request, with what it would save; change nothing until " +
        "I agree.",
    },
  ],
  "me-oversized-context": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows money spent on oversized context over {period}. Show me the 3 ' +
        "sessions that carried the most.",
    },
    {
      kind: "propose-fix",
      shown: "problem",
      prompt:
        'From "{question}", propose the change to my coding setup that keeps context under ' +
        "the line (compact earlier, hand work to subagents), as a pull request; change " +
        "nothing until I agree.",
    },
  ],
  "me-subagent-context": [
    {
      kind: "click",
      on: "subagent type",
      prompt:
        'On "{question}", why does {subagent type} carry this much context, and could it ' +
        "start smaller?",
    },
  ],
  "me-steps": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows tasks taking many model calls over {period}. Show me the 3 ' +
        "longest tasks and where the extra calls went.",
    },
  ],
  "me-harness-effect": [
    {
      kind: "click",
      on: "skill, MCP or CLI",
      prompt:
        'On "{question}", how do sessions with {skill, MCP or CLI} compare with sessions ' +
        "without it, and is the difference likely real?",
    },
  ],
  "me-tool-mix": [
    {
      kind: "click",
      on: "tool",
      prompt: 'On "{question}", why does {tool} send so many tokens, and how could I trim it?',
    },
  ],
  "me-clis-mcps": [
    {
      kind: "click",
      on: "CLI or MCP server",
      prompt:
        'On "{question}", how do I use {CLI or MCP server} over {period}, and is it worth ' +
        "what it costs?",
    },
  ],
  "me-harness-changes": [
    {
      kind: "click",
      on: "change",
      prompt: 'On "{question}", what did "{change}" do to my cost and speed since it happened?',
    },
  ],
  "me-skills-in-use": [
    {
      kind: "click",
      on: "skill",
      prompt: 'On "{question}", when does {skill} run and does it help the sessions it runs in?',
    },
  ],
  "me-harness-speed": [
    {
      kind: "investigate",
      shown: "problem",
      prompt:
        '"{question}" shows tools that slow my coding agents over {period}. For the slowest, ' +
        "show me the slow calls and why.",
    },
    {
      kind: "click",
      on: "tool",
      prompt: 'On "{question}", why is {tool} slow, and how could I speed it up?',
    },
  ],
  "me-dead-weight": [
    {
      kind: "propose-fix",
      label: "Remove unused servers",
      shown: "problem",
      prompt:
        'From "{question}", propose removing or lazy-loading the MCP servers I rarely call, ' +
        "as a pull request on my coding setup, with the tokens it saves per session; change " +
        "nothing until I agree.",
    },
  ],
  "me-provider-replay": [
    {
      kind: "click",
      on: "vendor",
      prompt:
        'On "{question}", what would my last month cost on {vendor}, and what would I give ' +
        "up?",
    },
  ],
};
