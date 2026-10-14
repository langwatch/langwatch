/*
 * Copyright © 2021-present Peter M. Stahl pemistahl@gmail.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either expressed or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
Package lingua accurately detects the natural language of written text, be it long or short.

# What this library does

Its task is simple: It tells you which language some text is written in.
This is very useful as a preprocessing step for linguistic data in natural language
processing applications such as text classification and spell checking.
Other use cases, for instance, might include routing e-mails to the right geographically
located customer service department, based on the e-mails' languages.

# Why this library exists

Language detection is often done as part of large machine learning frameworks or natural
language processing applications. In cases where you don't need the full-fledged
functionality of those systems or don't want to learn the ropes of those,
a small flexible library comes in handy.

So far, the only other comprehensive open source library in the Go ecosystem for this task
is Whatlanggo (https://github.com/abadojack/whatlanggo).
Unfortunately, it has two major drawbacks:

1. Detection only works with quite lengthy text fragments. For very short text snippets
such as Twitter messages, it does not provide adequate results.

2. The more languages take part in the decision process, the less accurate are the
detection results.

Lingua aims at eliminating these problems. It nearly does not need any configuration and
yields pretty accurate results on both long and short text, even on single words and phrases.
It draws on both rule-based and statistical methods but does not use any dictionaries of words.
It does not need a connection to any external API or service either.
Once the library has been downloaded, it can be used completely offline.

# Supported languages

Compared to other language detection libraries, Lingua's focus is on quality over quantity,
that is, getting detection right for a small set of languages first before adding new ones.
Currently, 75 languages are supported. They are listed as variants of type Language.

# How good it is

Lingua is able to report accuracy statistics for some bundled test data available for each
supported language. The test data for each language is split into three parts:

1. a list of single words with a minimum length of 5 characters

2. a list of word pairs with a minimum length of 10 characters

3. a list of complete grammatical sentences of various lengths

Both the language models and the test data have been created from separate documents of the
Wortschatz corpora (https://wortschatz.uni-leipzig.de) offered by Leipzig University, Germany.
Data crawled from various news websites have been used for training, each corpus comprising one
million sentences. For testing, corpora made of arbitrarily chosen websites have been used,
each comprising ten thousand sentences. From each test corpus, a random unsorted subset of
1000 single words, 1000 word pairs and 1000 sentences has been extracted, respectively.

Given the generated test data, I have compared the detection results of Lingua, and
Whatlanggo running over the data of Lingua's supported 75 languages.
Additionally, I have added Google's CLD3 (https://github.com/google/cld3/) to the comparison
with the help of the gocld3 bindings (https://github.com/jmhodges/gocld3). Languages that are not
supported by CLD3 or Whatlanggo are simply ignored during the detection process.
Lingua clearly outperforms its contenders.

# Why it is better than other libraries

Every language detector uses a probabilistic n-gram (https://en.wikipedia.org/wiki/N-gram)
model trained on the character distribution in some training corpus. Most libraries only use
n-grams of size 3 (trigrams) which is satisfactory for detecting the language of longer text
fragments consisting of multiple sentences. For short phrases or single words, however,
trigrams are not enough. The shorter the input text is, the less n-grams are available.
The probabilities estimated from such few n-grams are not reliable. This is why Lingua makes
use of n-grams of sizes 1 up to 5 which results in much more accurate prediction of the correct
language.

A second important difference is that Lingua does not only use such a statistical model, but
also a rule-based engine. This engine first determines the alphabet of the input text and
searches for characters which are unique in one or more languages. If exactly one language can
be reliably chosen this way, the statistical model is not necessary anymore. In any case, the
rule-based engine filters out languages that do not satisfy the conditions of the input text.
Only then, in a second step, the probabilistic n-gram model is taken into consideration.
This makes sense because loading less language models means less memory consumption and better
runtime performance.

In general, it is always a good idea to restrict the set of languages to be considered in the
classification process using the respective api methods. If you know beforehand that certain
languages are never to occur in an input text, do not let those take part in the classifcation
process. The filtering mechanism of the rule-based engine is quite good, however, filtering
based on your own knowledge of the input text is always preferable.
*/
package lingua
